// ==UserScript==
// @name         Allen → PDF 문제집 수집
// @namespace    local.allen-pdf-workbook
// @version      0.1.10
// @description  Allen 문제·표·정답과 원시험 정보를 검증하며 문제집 및 KMLE JSON용으로 모읍니다.
// @match        *://allenslibrary.com/*
// @match        *://*.allenslibrary.com/*
// @run-at       document-start
// @grant        GM_info
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'allenPdfWorkbookItemsV1';
  const SETTINGS_KEY = 'allenPdfWorkbookSettingsV1';
  const SCRIPT_VERSION = '0.1.10';
  // KMLE 목차 자동 순회기가 켜는 공유 신호. 이때는 단원마다 confirm/alert를
  // 띄우지 않고 DOM 완료 이벤트로 결과를 알린다.
  const KMLE_AUTOMATION_KEY = 'allenPdfKmleAutomationV1';
  const AUTO_RESULT_KEY = 'allenPdfLastAutoResultV1';
  const CIRCLED = Array.from('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳');
  let autoRunning = false;
  let autoStats = { saved: 0, skipped: 0, failed: 0, current: '', error: '', pageUrl: '' };
  let autoSession = null;
  const problemDataCache = new Map();

  function workbookStorage() {
    // sessionStorage is isolated per browser tab. This prevents two Allen
    // tabs collecting different workbooks from mixing into one PDF.
    return window.sessionStorage || window.localStorage;
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  }

  function lines() {
    return document.body.innerText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function marker(index) {
    return CIRCLED[index] || `${index + 1})`;
  }

  function stripChoiceMeta(text) {
    return String(text).replace(/\s+(?:오답|정답|\d{1,3}%)\s*$/g, '').trim();
  }

  function parseCombinedChoiceLine(line) {
    const text = String(line || '').trim();
    const circledIndex = CIRCLED.indexOf(text[0]);
    if (circledIndex >= 0) {
      const value = stripChoiceMeta(text.slice(1));
      return value ? { number: circledIndex + 1, text: value } : null;
    }
    const match = text.match(/^(\d{1,2})\s*[.)]?\s+(.+)$/);
    if (!match) return null;
    const value = stripChoiceMeta(match[2]);
    return value ? { number: Number(match[1]), text: value } : null;
  }

  function readChoiceAt(allLines, index, expectedNumber) {
    const combined = parseCombinedChoiceLine(allLines[index]);
    if (combined?.number === expectedNumber) return { text: combined.text, endIndex: index };
    if (allLines[index] !== String(expectedNumber)) return null;
    const ignored = /^(?:오답|정답|\d{1,3}%|정답입니다\.|오답입니다\.)$/;
    let textIndex = index + 1;
    while (textIndex < allLines.length && ignored.test(allLines[textIndex])) textIndex += 1;
    const value = stripChoiceMeta(allLines[textIndex] || '');
    return value ? { text: value, endIndex: textIndex } : null;
  }

  function findChoiceStart(allLines, start) {
    for (let i = start; i < allLines.length; i += 1) {
      const first = readChoiceAt(allLines, i, 1);
      if (!first) continue;
      for (let j = first.endIndex + 1; j < Math.min(allLines.length, first.endIndex + 12); j += 1) {
        if (readChoiceAt(allLines, j, 2)) return i;
      }
    }
    return -1;
  }

  function extractSourceTag(text = document.body.innerText) {
    const besideNumber = text.match(/\d+번\s*\[([^\[\]\n]{2,50})\]/);
    if (besideNumber) return besideNumber[1].trim();
    const candidates = [...text.matchAll(/\[([^\[\]\n]{2,50})\]/g)].map((match) => match[1].trim());
    return candidates.find((value) => /\d/.test(value)) || '';
  }

  function currentProblemId() {
    const idMatch = String(globalThis.location?.pathname || '').match(/\/problem\/(\d+)/);
    return idMatch ? Number.parseInt(idMatch[1], 10) : null;
  }

  function matchingProblemData(candidates) {
    const expectedId = currentProblemId();
    return candidates.find((problem) => {
      if (!problem || typeof problem !== 'object') return false;
      const problemId = Number(problem.problemId || problem.id);
      return !expectedId || problemId === expectedId;
    }) || null;
  }

  function currentProblemData() {
    const candidates = [];
    const components = globalThis.next?.router?.components;
    if (components && typeof components === 'object') {
      for (const component of Object.values(components)) {
        candidates.push(component?.props?.pageProps?.serverData?.problem);
      }
    }
    candidates.push(globalThis.__NEXT_DATA__?.props?.pageProps?.serverData?.problem);
    if (typeof document !== 'undefined') {
      try {
        const raw = document.getElementById('__NEXT_DATA__')?.textContent;
        if (raw) candidates.push(JSON.parse(raw)?.props?.pageProps?.serverData?.problem);
      } catch (_) {
        // 화면 DOM 판독을 계속 사용한다.
      }
    }
    return matchingProblemData(candidates);
  }

  function problemDataFromPageHtml(html) {
    if (!html) return null;
    let raw = '';
    if (typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(String(html), 'text/html');
      raw = parsed.getElementById('__NEXT_DATA__')?.textContent || '';
    } else {
      raw = String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || '';
    }
    if (!raw) return null;
    try {
      const value = JSON.parse(raw)?.props?.pageProps?.serverData?.problem;
      return matchingProblemData([value]);
    } catch (_) {
      return null;
    }
  }

  async function loadCurrentProblemData() {
    const embedded = currentProblemData();
    if (embedded) return embedded;
    const cacheKey = location.href;
    if (problemDataCache.has(cacheKey)) return problemDataCache.get(cacheKey);
    const response = await fetch(cacheKey, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`공식 문제 데이터 요청 실패: HTTP ${response.status}`);
    const problem = problemDataFromPageHtml(await response.text());
    if (!problem) throw new Error('현재 URL과 일치하는 공식 문제 데이터를 찾지 못했습니다.');
    problemDataCache.set(cacheKey, problem);
    return problem;
  }

  function htmlText(value) {
    if (!value) return '';
    if (typeof DOMParser === 'undefined') return String(value).replace(/<[^>]+>/g, '');
    const parsed = new DOMParser().parseFromString(`<main>${value}</main>`, 'text/html');
    return String(parsed.querySelector('main')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSourceExamMeta(code = extractSourceTag(), title = document.title, problem = currentProblemData()) {
    const embeddedExam = String(problem?.examName || '').trim();
    const embeddedSession = Number.parseInt(problem?.examPeriod, 10);
    const embeddedNumber = Number.parseInt(problem?.examNumber, 10);
    if (embeddedExam && embeddedSession > 0 && embeddedNumber > 0) {
      return {
        sourceLabel: `${embeddedExam} ${embeddedSession}교시, ${embeddedNumber}번`,
        sourceExam: embeddedExam,
        sourceSession: embeddedSession,
        sourceQuestionNumber: embeddedNumber,
      };
    }
    const sourceLabel = String(title || '')
      .replace(/\s*\|\s*알렌의\s*서재.*$/i, '')
      .trim();
    const match = sourceLabel.match(/^(.*?)\s+(\d+)교시\s*[,·]?\s*(\d+)번(?:\s|$)/);
    return {
      sourceLabel,
      sourceExam: match?.[1]?.trim() || code || '',
      sourceSession: match ? Number.parseInt(match[2], 10) : null,
      sourceQuestionNumber: match ? Number.parseInt(match[3], 10) : null,
    };
  }

  function extractChapter(allLines = lines()) {
    const exitIndex = allLines.indexOf('나가기');
    const candidates = allLines.slice(0, exitIndex >= 0 ? exitIndex : 8)
      .filter((line) => !/^\d+$/.test(line) && line !== '/');
    return candidates[0] || '미분류';
  }

  function extractQuestion(allLines) {
    const markerIndex = allLines.findIndex((line) => /^(정답 확인|해설 닫기)$/.test(line));
    const start = markerIndex >= 0 ? markerIndex + 1 : 0;
    const choiceStart = findChoiceStart(allLines, start);
    if (choiceStart < 0) throw new Error('1번 선지가 시작되는 위치를 찾지 못했습니다.');
    const questionLines = allLines.slice(start, choiceStart)
      .filter((line) => !/^(정답 확인|해설 닫기|저장)$/.test(line));
    if (!questionLines.length) throw new Error('문제 본문을 찾지 못했습니다.');
    return {
      text: questionLines.join('\n'),
      anchorText: questionLines[questionLines.length - 1],
      lineIndex: choiceStart - 1,
    };
  }

  function extractChoices(allLines, questionLineIndex) {
    const choices = [];
    const stopLines = new Set(['정답률', '누적 풀이 횟수', '평균 풀이 시간', 'CC', '해설']);
    for (let i = questionLineIndex + 1; i < allLines.length && choices.length < 20; i += 1) {
      if (choices.length >= 2 && stopLines.has(allLines[i])) break;
      const parsed = readChoiceAt(allLines, i, choices.length + 1);
      if (!parsed) continue;
      choices.push(parsed.text);
      i = parsed.endIndex;
    }
    if (choices.length < 2) throw new Error(`선지를 충분히 찾지 못했습니다. 현재 ${choices.length}개를 찾았습니다.`);
    return choices;
  }

  function makeId(question, choices) {
    const value = `${question}\n${choices.join('\n')}`.replace(/\s+/g, ' ').trim();
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `allen_pdf_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function findTextElements(exactText) {
    const matches = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim() !== exactText) continue;
      const el = node.parentElement;
      if (visible(el)) matches.push(el);
    }
    return matches;
  }

  function findTextElement(exactText) {
    return findTextElements(exactText)[0] || null;
  }

  function cloneTable(table) {
    const clone = table.cloneNode(true);
    clone.removeAttribute('class');
    clone.style.cssText = 'width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;';
    for (const cell of clone.querySelectorAll('th,td')) {
      cell.removeAttribute('class');
      cell.style.cssText = 'border:1px solid #777;padding:5px 7px;text-align:left;vertical-align:middle;';
    }
    for (const header of clone.querySelectorAll('th')) {
      header.style.background = '#eef6fa';
      header.style.fontWeight = '700';
    }
    for (const img of clone.querySelectorAll('img')) {
      img.src = new URL(img.currentSrc || img.src, location.href).href;
      img.style.cssText = 'max-width:100%;height:auto;';
    }
    return `<div class="table-wrap">${clone.outerHTML}</div>`;
  }

  function contentHtmlBetween(questionAnchor, firstChoice) {
    const qElement = findTextElement(questionAnchor);
    const cElement = findTextElement(firstChoice);
    if (!qElement || !cElement) return '';
    const markerEl = findTextElement('정답 확인') || findTextElement('해설 닫기');
    const top = markerEl ? markerEl.getBoundingClientRect().bottom : qElement.getBoundingClientRect().bottom;
    const bottom = cElement.getBoundingClientRect().top;
    const items = [];

    for (const table of document.querySelectorAll('table')) {
      if (!visible(table)) continue;
      const box = table.getBoundingClientRect();
      if (box.top < top - 5 || box.bottom > bottom + 5) continue;
      items.push({ top: box.top, html: cloneTable(table) });
    }
    for (const img of document.images) {
      if (!visible(img) || img.closest('table')) continue;
      const box = img.getBoundingClientRect();
      if (box.top < top - 5 || box.bottom > bottom + 5 || img.naturalWidth < 80 || img.naturalHeight < 80) continue;
      const src = new URL(img.currentSrc || img.src, location.href).href;
      items.push({ top: box.top, html: `<div class="image"><img src="${escapeHtml(src)}"></div>` });
    }
    return items.sort((a, b) => a.top - b.top).map((item) => item.html).join('');
  }

  function isExplanationHeading(line) {
    return /^(?:\d+\.\s*)?(?:한줄요약|출제\s*Point|CC|Hx|S\/Sx|Lab|Img|Etc|해설|Tip|오답 선지|관련 이론|Reference)$/.test(line);
  }

  function findExplanationStartIndex(allLines) {
    const rateIndex = allLines.indexOf('정답률');
    const searchStart = rateIndex >= 0 ? rateIndex + 1 : 0;
    const direct = allLines
      .map((line, index) => (index >= searchStart && /^(?:CC|해설)(?:\s|$)/.test(line) ? index : -1))
      .filter((index) => index >= 0);
    if (direct.length) return Math.min(...direct);
    const structured = allLines.findIndex((line, index) => (
      index >= searchStart && /^(?:\d+\.\s*)?(?:한줄요약|출제\s*Point)$/.test(line)
    ));
    if (structured >= 0) return structured;
    if (rateIndex >= 0) {
      const afterStats = allLines.findIndex((line, index) => index > rateIndex && isExplanationHeading(line));
      if (afterStats >= 0) return afterStats;
    }
    return -1;
  }

  function findExplanationStartElement() {
    const rateElement = findTextElement('정답률');
    const minimumTop = rateElement ? rateElement.getBoundingClientRect().bottom : Number.NEGATIVE_INFINITY;
    return ['CC', '해설', '1. 한줄요약', '한줄요약', '2. 출제 Point', '출제 Point']
      .flatMap((text) => findTextElements(text))
      .filter((element) => element.getBoundingClientRect().top >= minimumTop)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
  }

  function elementLines(element) {
    return String(element?.innerText || '')
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function findLineSequence(linesToSearch, sequence, startAt = 0) {
    if (!sequence.length || sequence.length > linesToSearch.length) return -1;
    for (let index = startAt; index <= linesToSearch.length - sequence.length; index += 1) {
      if (sequence.every((line, offset) => linesToSearch[index + offset] === line)) return index;
    }
    return -1;
  }

  function explanationBounds() {
    const startEl = findExplanationStartElement();
    const endEl = findTextElement('커뮤니티 Q&A');
    if (!startEl) return null;
    const startContainer = startEl.closest('table') || startEl;
    return {
      top: startContainer.getBoundingClientRect().top - 2,
      bottom: endEl ? endEl.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
    };
  }

  function explanationTables() {
    const bounds = explanationBounds();
    if (!bounds) return [];
    return [...document.querySelectorAll('table')]
      .filter((table) => {
        if (!visible(table)) return false;
        const box = table.getBoundingClientRect();
        return box.top >= bounds.top && box.bottom <= bounds.bottom;
      })
      .map((table) => ({
        top: table.getBoundingClientRect().top,
        lines: elementLines(table),
        html: cloneTable(table),
      }))
      .sort((a, b) => a.top - b.top);
  }

  function extractExplanation(allLines) {
    const start = findExplanationStartIndex(allLines);
    if (start < 0) return { html: '', embeddedTables: [] };
    let end = allLines.indexOf('커뮤니티 Q&A', start);
    if (end < 0) end = allLines.length;
    const sourceLines = allLines.slice(start, end);
    const tableEntries = explanationTables();
    const replacements = new Map();
    const embeddedTables = [];
    let searchFrom = 0;
    tableEntries.forEach((table, tableIndex) => {
      let lineIndex = findLineSequence(sourceLines, table.lines, searchFrom);
      if (lineIndex < 0) lineIndex = findLineSequence(sourceLines, table.lines);
      if (lineIndex < 0) return;
      replacements.set(lineIndex, { end: lineIndex + table.lines.length, html: table.html });
      embeddedTables.push(tableIndex);
      searchFrom = lineIndex + table.lines.length;
    });

    const source = [];
    let previousText = '';
    for (let index = 0; index < sourceLines.length;) {
      const replacement = replacements.get(index);
      if (replacement) {
        source.push({ html: replacement.html });
        index = replacement.end;
        previousText = '';
        continue;
      }
      const line = sourceLines[index];
      if (line && line !== previousText) source.push(line);
      previousText = line;
      index += 1;
    }

    const sections = [];
    let section = null;
    for (const line of source) {
      if (typeof line !== 'string') {
        if (!section) section = { heading: '', content: [] };
        section.content.push(line);
        continue;
      }
      if (isExplanationHeading(line)) {
        if (section) sections.push(section);
        section = { heading: line, content: [] };
      } else {
        if (!section) section = { heading: '', content: [] };
        section.content.push(line);
      }
    }
    if (section) sections.push(section);
    const html = sections
      .filter((item) => item.content.length > 0)
      .map((item) => {
        const heading = item.heading ? `<h4>${escapeHtml(item.heading)}</h4>` : '';
        const content = item.content
          .map((line) => (typeof line === 'string' ? `<p>${escapeHtml(line)}</p>` : line.html))
          .join('');
        return `${heading}${content}`;
      })
      .join('');
    return { html, embeddedTables };
  }

  function explanationAssetsHtml(embeddedTables = []) {
    const bounds = explanationBounds();
    if (!bounds) return '';
    const items = [];

    explanationTables().forEach((table, tableIndex) => {
      if (!embeddedTables.includes(tableIndex)) items.push({ top: table.top, html: table.html });
    });
    for (const img of document.images) {
      if (!visible(img) || img.closest('table')) continue;
      const box = img.getBoundingClientRect();
      if (box.top < bounds.top || box.bottom > bounds.bottom || img.naturalWidth < 80 || img.naturalHeight < 80) continue;
      const src = new URL(img.currentSrc || img.src, location.href).href;
      items.push({ top: box.top, html: `<div class="image"><img src="${escapeHtml(src)}"></div>` });
    }
    if (!items.length) return '';
    return `<h4>해설 표·이미지</h4>${items.sort((a, b) => a.top - b.top).map((item) => item.html).join('')}`;
  }

  function extractAnswer(allLines, choices, problem = currentProblemData()) {
    const isCorrectBlue = (el) => {
      let current = el;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
        const styles = getComputedStyle(current);
        const colors = [styles.color, styles.webkitTextFillColor].filter(Boolean);
        for (const color of colors) {
          const match = color.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
          if (!match) continue;
          const [, red, green, blue] = match.map(Number);
          if (blue >= 150 && blue - red >= 55 && blue - green >= 25) return true;
        }
      }
      return false;
    };
    const styledAnswers = choices
      .map((choice, index) => ({ index, text: choice, elements: findTextElements(choice) }))
      .filter((item) => item.elements.some(isCorrectBlue))
      .map(({ index, text }) => ({ index, text }));
    if (styledAnswers.length) return styledAnswers;

    return embeddedAnswers(choices, problem);
  }

  function embeddedAnswers(choices, problem = currentProblemData()) {
    // 일부 최신 문제는 정답 선지의 CSS 색상이 바뀌어 색상만으로 판독할 수 없다.
    // 현재 URL과 ID가 일치하는 Next.js 원문 데이터의 1-based 정답 번호를 보조로 쓴다.
    const embeddedChoices = Array.isArray(problem?.choices)
      ? problem.choices.map(htmlText)
      : [];
    if (
      !Array.isArray(problem?.answer)
      || embeddedChoices.length !== choices.length
      || embeddedChoices.some((choice, index) => choice !== choices[index])
    ) return [];
    return [...new Set(problem.answer)]
      .map((number) => Number.parseInt(number, 10) - 1)
      .filter((index) => index >= 0 && index < choices.length)
      .map((index) => ({ index, text: choices[index] }));
  }

  function extractChoiceRates(allLines, choices, problem = currentProblemData()) {
    const rates = Array(choices.length).fill('');
    const usedLineIndexes = new Set();

    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
      const choice = choices[choiceIndex];
      for (let lineIndex = 0; lineIndex < allLines.length; lineIndex += 1) {
        if (usedLineIndexes.has(lineIndex)) continue;
        const line = stripChoiceMeta(allLines[lineIndex]);
        if (line !== choice) continue;
        const nearby = allLines
          .slice(lineIndex + 1, Math.min(allLines.length, lineIndex + 6))
          .find((value) => /^\d{1,3}%$/.test(value));
        if (nearby) {
          rates[choiceIndex] = nearby;
          usedLineIndexes.add(lineIndex);
          break;
        }
      }
    }

    // Fallback: in some layouts the percentages appear as a compact group
    // after all choices. Use the first N visible percentages after choice 1.
    if (rates.filter(Boolean).length < Math.min(2, choices.length)) {
      const firstChoiceLine = allLines.findIndex((line) => stripChoiceMeta(line) === choices[0]);
      if (firstChoiceLine >= 0) {
        const groupedRates = allLines
          .slice(firstChoiceLine)
          .filter((line) => /^\d{1,3}%$/.test(line))
          .slice(0, choices.length);
        if (groupedRates.length === choices.length) return groupedRates;
      }
    }

    if (
      rates.filter(Boolean).length < Math.min(2, choices.length)
      && Array.isArray(problem?.choiceCount)
      && problem.choiceCount.length === choices.length
      && Number(problem.totalAttempts) > 0
    ) {
      return problem.choiceCount.map((count) => (
        `${Math.floor((Number(count) / Number(problem.totalAttempts)) * 100)}%`
      ));
    }

    return rates;
  }

  function embeddedExplanationHtml(problem = currentProblemData()) {
    const solution = String(problem?.solution || '');
    if (!solution || /class=["'][^"']*content-gate/.test(solution)) return '';
    if (typeof DOMParser === 'undefined') return solution;
    const parsed = new DOMParser().parseFromString(`<main>${solution}</main>`, 'text/html');
    parsed.querySelectorAll('script, style, iframe, object').forEach((element) => element.remove());
    return parsed.querySelector('main')?.innerHTML || '';
  }

  async function ensureAnswerOpen() {
    if (document.body.innerText.includes('해설 닫기')) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answerButton = [...document.querySelectorAll('button')]
        .find((button) => button.innerText.trim() === '정답 확인' && visible(button));
      if (!answerButton) {
        if (document.body.innerText.includes('해설 닫기')) return;
        throw new Error('정답 확인 버튼을 찾지 못했습니다.');
      }
      answerButton.click();
      try {
        await waitUntil(() => document.body.innerText.includes('해설 닫기'), 12000, '해설이 열리지 않았습니다.');
        return;
      } catch (error) {
        if (attempt === 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  function extractFrontData(problem = currentProblemData()) {
    const allLines = lines();
    const question = extractQuestion(allLines);
    const choices = extractChoices(allLines, question.lineIndex);
    const code = extractSourceTag();
    const sourceMeta = extractSourceExamMeta(code, document.title, problem);
    return {
      id: makeId(question.text, choices),
      code,
      ...sourceMeta,
      chapter: extractChapter(allLines),
      question: question.text,
      choices,
      contentHtml: contentHtmlBetween(question.anchorText, choices[0]),
      url: location.href,
    };
  }

  function extractBackData(front, problem = currentProblemData()) {
    const allLines = lines();
    const explanation = extractExplanation(allLines);
    return {
      answers: extractAnswer(allLines, front.choices, problem),
      choiceRates: extractChoiceRates(allLines, front.choices, problem),
      explanationHtml: explanation.html || embeddedExplanationHtml(problem),
      explanationAssetsHtml: explanationAssetsHtml(explanation.embeddedTables),
    };
  }

  function workbook() {
    try {
      const value = JSON.parse(workbookStorage().getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function saveWorkbook(items) {
    workbookStorage().setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function settings() {
    try {
      return { includeAnswer: true, includeExplanation: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch (_) {
      return { includeAnswer: true, includeExplanation: true };
    }
  }

  function saveSettings(value) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  }

  async function collectCurrent(showAlert = true, session = null) {
    const savedSettings = settings();
    const cfg = session?.forceKmle
      ? { ...savedSettings, includeAnswer: true, includeExplanation: true }
      : savedSettings;
    let problem = currentProblemData();
    let front = extractFrontData(problem);
    if (session?.chapter && front.chapter !== session.chapter) {
      throw new Error(`시작 단원과 현재 단원이 다릅니다.\n시작 단원: ${session.chapter}\n현재 단원: ${front.chapter}`);
    }
    const items = workbook();
    if (items.some((item) => item.id === front.id)) {
      if (showAlert) alert(`이미 수집된 문제입니다.\n${front.code || front.id}`);
      return { skipped: true, item: front };
    }
    let back = { answers: [], choiceRates: [], explanationHtml: '', explanationAssetsHtml: '' };
    if (cfg.includeAnswer || cfg.includeExplanation) {
      await ensureAnswerOpen();
      back = extractBackData(front, problem);
    }
    if (
      session?.forceKmle
      && (!problem || !front.sourceSession || back.answers.length === 0
        || (!back.explanationHtml && !back.explanationAssetsHtml))
    ) {
      problem = await loadCurrentProblemData();
      front = { ...front, ...extractSourceExamMeta(front.code, document.title, problem) };
      back = extractBackData(front, problem);
    }
    if (cfg.includeAnswer && back.answers.length === 0) {
      throw new Error(`정답을 판독하지 못했습니다. 이 페이지에서 수집을 중단합니다.\n${front.code || front.id}`);
    }
    if (cfg.includeExplanation && !back.explanationHtml && !back.explanationAssetsHtml) {
      throw new Error(`해설을 판독하지 못했습니다. 이 페이지에서 수집을 중단합니다.\n${front.code || front.id}`);
    }
    const item = {
      ...front,
      includeAnswer: cfg.includeAnswer,
      includeExplanation: cfg.includeExplanation,
      answers: cfg.includeAnswer ? back.answers : [],
      choiceRates: cfg.includeAnswer ? back.choiceRates : [],
      explanationHtml: cfg.includeExplanation ? back.explanationHtml : '',
      explanationAssetsHtml: cfg.includeExplanation ? back.explanationAssetsHtml : '',
      collectedAt: new Date().toISOString(),
    };
    items.push(item);
    saveWorkbook(items);
    if (showAlert) alert(`PDF 문제집에 추가 완료\n단원: ${front.chapter}\n출처: ${front.code || '미표기'}\n현재 ${items.length}문항`);
    return { skipped: false, item };
  }

  function renderQuestionBody(item, withCorrect = false, withRates = false) {
    const choices = item.choices.map((choice, idx) => {
      const correct = withCorrect && (item.answers || []).some((answer) => answer.index === idx);
      const rate = withRates ? (item.choiceRates || [])[idx] : '';
      const rateHtml = rate ? `<span class="choice-rate">${escapeHtml(rate)}</span>` : '';
      return `<li class="${correct ? 'correct' : ''}"><span class="choice-main"><span class="marker">${marker(idx)}</span> ${escapeHtml(choice)}</span>${rateHtml}</li>`;
    }).join('');
    return `<div class="question">${escapeHtml(item.question).replaceAll('\n', '<br>')}</div>
      ${item.contentHtml || ''}
      <ol class="choices">${choices}</ol>`;
  }

  function renderProblem(item, index) {
    return `<article class="problem">
      <header>
        <div class="meta">${escapeHtml(item.chapter || '미분류')} · ${escapeHtml(item.code || '출처 미표기')}</div>
        <h2>${index + 1}번</h2>
      </header>
      ${renderQuestionBody(item, false, false)}
    </article>`;
  }

  function renderAnswer(item, index) {
    const answerText = (item.answers || []).map((answer) => `${marker(answer.index)} ${escapeHtml(answer.text)}`).join(', ');
    const answerBlock = item.includeAnswer && answerText
      ? `<div class="answer">정답: ${answerText}</div>`
      : '<div class="answer muted">정답 정보 없음</div>';
    const explanationBlock = item.includeExplanation && (item.explanationHtml || item.explanationAssetsHtml)
      ? `<section class="explanation">${item.explanationHtml || ''}${item.explanationAssetsHtml || ''}</section>`
      : '';
    return `<article class="answer-page">
      <header>
        <div class="meta">${escapeHtml(item.chapter || '미분류')} · ${escapeHtml(item.code || '출처 미표기')}</div>
        <h2>${index + 1}번 정답/해설</h2>
      </header>
      ${renderQuestionBody(item, true, true)}
      ${answerBlock}
      ${explanationBlock}
    </article>`;
  }

  function previewPdf() {
    const items = workbook();
    if (!items.length) {
      alert('아직 수집한 문제가 없습니다.');
      return;
    }
    const chapter = items[0]?.chapter || 'Allen 문제집';
    const title = prompt('PDF 제목을 입력하세요.', `${chapter} 문제집`) || `${chapter} 문제집`;
    const doc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin:0; color:#111; font-family: Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; line-height:1.55; }
  .toolbar { position:sticky; top:0; z-index:10; display:flex; gap:8px; align-items:center; justify-content:space-between;
    padding:10px 14px; background:#EEF9FF; border-bottom:1px solid #A9DDF5; }
  .toolbar button { padding:8px 12px; border:1px solid #8ED8F5; border-radius:8px; background:#DDF4FF; color:#08749A; font-weight:800; cursor:pointer; }
  .cover { min-height:45vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; page-break-after:always; }
  .cover h1 { font-size:30px; margin:0 0 10px; }
  .cover p { color:#555; margin:3px 0; }
  .part-title { min-height:35vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; page-break-after:always; }
  .part-title h1 { font-size:28px; margin:0 0 8px; }
  .part-title p { color:#666; margin:0; }
  .problem, .answer-page { page-break-after:always; padding:2mm 0; }
  .problem header, .answer-page header { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #222; padding-bottom:6px; margin-bottom:12px; }
  .problem h2, .answer-page h2 { margin:0; font-size:22px; }
  .meta { color:#666; font-size:12px; }
  .question { font-size:16px; margin:0 0 12px; white-space:normal; }
  .image { margin:12px 0; text-align:center; break-inside:avoid; }
  .image img { max-width:100%; max-height:150mm; height:auto; }
  .table-wrap { overflow:visible; break-inside:avoid; }
  .choices { list-style:none; padding:0; margin:14px 0 8px; }
  .choices li { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin:7px 0; padding-left:2px; font-size:15px; }
  .choice-main { min-width:0; }
  .choice-rate { flex:0 0 auto; min-width:42px; text-align:center; padding:1px 7px; border-radius:999px; background:#F3F6F8; color:#555; font-size:12px; font-weight:700; text-decoration:none !important; }
  .choices .marker { font-weight:700; margin-right:5px; }
  .choices li.correct { color:#1A43BF; font-weight:800; text-decoration:underline; text-underline-offset:3px; }
  .answer { margin:14px 0; color:#1A43BF; font-weight:800; text-decoration:underline; text-underline-offset:3px; }
  .answer.muted { color:#777; text-decoration:none; font-weight:700; }
  .explanation { margin-top:14px; border-top:1px solid #ddd; padding-top:10px; font-size:13px; }
  .explanation h4 { font-size:14px; margin:11px 0 4px; }
  .explanation p { margin:3px 0; }
  @media print {
    .toolbar { display:none; }
    a { color:inherit; text-decoration:none; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <strong>${escapeHtml(title)} · ${items.length}문항</strong>
    <button onclick="window.print()">PDF로 저장 / 인쇄</button>
  </div>
  <section class="cover">
    <h1>${escapeHtml(title)}</h1>
    <p>${items.length}문항</p>
    <p>${new Date().toLocaleString()}</p>
  </section>
  <section class="part-title">
    <h1>문제</h1>
    <p>정답 표시는 뒤쪽 정답/해설 파트에 있습니다.</p>
  </section>
  ${items.map(renderProblem).join('\n')}
  <section class="part-title">
    <h1>정답/해설</h1>
    <p>각 문항의 문제, 선지, 정답, 해설을 함께 실었습니다.</p>
  </section>
  ${items.map(renderAnswer).join('\n')}
</body>
</html>`;
    const popup = window.open('', '_blank');
    if (!popup) {
      alert('팝업이 차단되었습니다. 팝업 허용 후 다시 눌러주세요.');
      return;
    }
    popup.document.open();
    popup.document.write(doc);
    popup.document.close();
  }

  function waitUntil(predicate, timeout, message) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > timeout) {
          clearInterval(timer);
          reject(new Error(message));
        }
      }, 200);
    });
  }

  function nextQuestion() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
  }

  function pageNumbers() {
    for (const input of document.querySelectorAll('input')) {
      if (!visible(input) || !/^\d+$/.test(String(input.value || '').trim())) continue;
      let container = input.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const match = (container.innerText || '').match(/\/\s*(\d+)/);
        if (!match) continue;
        return {
          current: Number.parseInt(input.value, 10),
          total: Number.parseInt(match[1], 10),
        };
      }
    }
    return null;
  }

  function pagePosition() {
    const position = pageNumbers();
    return position ? `${position.current}/${position.total}` : '?/?';
  }

  function updateProgress(message = '') {
    const panel = document.getElementById('allen-pdf-progress');
    if (!panel) return;
    const total = workbook().length;
    const detail = message || (autoStats.error ? `중단: ${autoStats.error}` : '');
    panel.innerHTML = `<b>${autoRunning ? 'PDF 자동 수집 중' : 'PDF 수집 대기'}</b> · ${pagePosition()} · 총 ${total} · 저장 ${autoStats.saved} · 건너뜀 ${autoStats.skipped} · 실패 ${autoStats.failed}${autoStats.current ? `<br>현재: ${escapeHtml(autoStats.current)}` : ''}${detail ? `<br>${escapeHtml(detail)}` : ''}`;
  }

  function updateAutoButton() {
    const button = document.getElementById('allen-pdf-auto');
    if (button) button.textContent = autoRunning ? 'PDF 자동 중단' : 'PDF 자동 수집';
    updateProgress();
  }

  async function runAuto() {
    if (autoRunning) return;
    const chapter = extractChapter();
    const kmleAutomation = workbookStorage().getItem(KMLE_AUTOMATION_KEY) === '1';
    const savedSettings = settings();
    const cfg = kmleAutomation
      ? { ...savedSettings, includeAnswer: true, includeExplanation: true }
      : savedSettings;
    const session = { chapter, forceKmle: kmleAutomation };
    const message = [
      '현재 문제부터 PDF 문제집 자동 수집을 시작할까요?',
      '',
      `단원명: ${chapter}`,
      `정답 포함: ${cfg.includeAnswer ? '예' : '아니오'}`,
      `해설 포함: ${cfg.includeExplanation ? '예' : '아니오'}`,
      '',
      '자동 수집 중 현재 단원명이 바뀌면 중단합니다.',
    ].join('\n');
    if (!kmleAutomation && !confirm(message)) return;
    autoRunning = true;
    autoSession = session;
    autoStats = { saved: 0, skipped: 0, failed: 0, current: '', error: '', pageUrl: '' };
    workbookStorage().removeItem(AUTO_RESULT_KEY);
    updateAutoButton();
    updateProgress(`고정 단원: ${chapter}`);
    try {
      while (autoRunning) {
        const front = extractFrontData();
        if (front.chapter !== autoSession.chapter) {
          throw new Error(`단원명이 바뀌어 자동 수집을 멈췄습니다.\n시작 단원: ${autoSession.chapter}\n현재 단원: ${front.chapter}`);
        }
        const beforeId = front.id;
        autoStats.current = front.code || beforeId;
        const result = await collectCurrent(false, autoSession);
        if (result.skipped) autoStats.skipped += 1;
        else autoStats.saved += 1;
        updateProgress(result.skipped ? '중복 문제를 건너뜀' : '문제집에 추가 완료');
        if (!autoRunning) break;
        const position = pageNumbers();
        if (position && position.current >= position.total) {
          if (!kmleAutomation) {
            alert(`PDF 자동 수집 종료\n저장: ${autoStats.saved}\n건너뜀: ${autoStats.skipped}`);
          }
          break;
        }
        nextQuestion();
        try {
          await waitUntil(() => {
            const next = extractFrontData();
            return next.id && next.id !== beforeId;
          }, 8000, '다음 문제로 이동하지 않았습니다. 마지막 문제일 수 있습니다.');
        } catch (error) {
          if (!kmleAutomation) {
            alert(`PDF 자동 수집 종료\n저장: ${autoStats.saved}\n건너뜀: ${autoStats.skipped}\n${error.message}`);
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (error) {
      autoStats.failed += 1;
      autoStats.error = error?.message || String(error);
      autoStats.pageUrl = location.href;
      updateProgress(`중단: ${error.message}`);
      if (!kmleAutomation) {
        alert(`PDF 자동 수집 중단\n저장: ${autoStats.saved}\n건너뜀: ${autoStats.skipped}\n실패: ${autoStats.failed}\n오류: ${error.message}`);
      }
      console.error('[Allen → PDF 문제집]', error);
    } finally {
      autoRunning = false;
      autoSession = null;
      if (kmleAutomation) workbookStorage().removeItem(KMLE_AUTOMATION_KEY);
      const result = { ...autoStats, chapter, finishedAt: Date.now() };
      workbookStorage().setItem(AUTO_RESULT_KEY, JSON.stringify(result));
      updateAutoButton();
      window.dispatchEvent(new CustomEvent('allen-pdf-auto-finished', {
        detail: result,
      }));
    }
  }

  function configure() {
    const cfg = settings();
    const includeAnswer = confirm('PDF 문제집에 정답을 포함할까요?');
    const includeExplanation = includeAnswer ? confirm('PDF 문제집에 해설도 포함할까요?') : false;
    saveSettings({ ...cfg, includeAnswer, includeExplanation });
    alert(`PDF 설정 저장 완료\n정답 포함: ${includeAnswer ? '예' : '아니오'}\n해설 포함: ${includeExplanation ? '예' : '아니오'}`);
    updateProgress();
  }

  function resetWorkbook() {
    const count = workbook().length;
    if (!count) {
      alert('비울 문제가 없습니다.');
      return;
    }
    if (!confirm(`현재 수집된 ${count}문항을 모두 비울까요?`)) return;
    saveWorkbook([]);
    updateProgress('문제집을 비웠습니다.');
  }

  function addButtons() {
    const existing = document.getElementById('allen-pdf-tools');
    if (existing?.dataset?.version === SCRIPT_VERSION) return;
    if (existing) existing.remove();
    if (!document.body) return;

    const box = document.createElement('div');
    box.id = 'allen-pdf-tools';
    box.dataset.version = SCRIPT_VERSION;
    box.style.cssText = 'position:fixed;left:10px;top:92px;z-index:2147483647;display:flex;flex-direction:column;align-items:stretch;gap:7px;width:142px;font-family:Pretendard,Apple SD Gothic Neo,sans-serif;pointer-events:auto';

    const progress = document.createElement('div');
    progress.id = 'allen-pdf-progress';
    progress.style.cssText = 'order:99;padding:8px 9px;border:1px solid #A9DDF5;border-radius:9px;background:#F0FAFF;color:#256784;font-size:11px;line-height:1.45;text-align:left;box-shadow:0 2px 10px #0002';

    const configButton = document.createElement('button');
    configButton.textContent = 'PDF 설정';
    configButton.onclick = configure;

    const currentButton = document.createElement('button');
    currentButton.textContent = 'PDF 현재 추가';
    currentButton.onclick = async () => {
      try {
        await collectCurrent(true);
        updateProgress();
      } catch (error) {
        alert(`PDF 수집 실패: ${error.message}`);
        console.error('[Allen → PDF 문제집]', error);
      }
    };

    const autoButton = document.createElement('button');
    autoButton.id = 'allen-pdf-auto';
    autoButton.textContent = 'PDF 자동 수집';
    autoButton.onclick = () => {
      if (autoRunning) {
        autoRunning = false;
        updateAutoButton();
      } else {
        runAuto();
      }
    };

    const previewButton = document.createElement('button');
    previewButton.textContent = 'PDF 미리보기';
    previewButton.onclick = previewPdf;

    const resetButton = document.createElement('button');
    resetButton.textContent = 'PDF 비우기';
    resetButton.onclick = resetWorkbook;

    for (const button of [configButton, currentButton, autoButton, previewButton, resetButton]) {
      button.style.cssText = 'width:142px;padding:9px 8px;border:1px solid #8ED8F5;border-radius:9px;background:#DDF4FF;color:#08749A;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 2px 10px #0002;white-space:nowrap';
      box.appendChild(button);
    }
    box.appendChild(progress);
    document.body.appendChild(box);
    updateProgress();
  }

  function showBootError(error) {
    console.error('[Allen → PDF 버튼 생성 실패]', error);
    if (!document.body || document.getElementById('allen-pdf-boot-error')) return;
    const box = document.createElement('div');
    box.id = 'allen-pdf-boot-error';
    box.style.cssText = 'position:fixed;left:10px;top:92px;z-index:2147483647;padding:10px 12px;border:1px solid #F5A0AD;border-radius:9px;background:#FFF0F2;color:#A12638;font-size:12px;font-weight:800;box-shadow:0 2px 10px #0002;white-space:pre-line';
    box.textContent = `Allen PDF 버튼 생성 실패\n${error?.message || error}`;
    document.body.appendChild(box);
  }

  function boot() {
    try {
      addButtons();
    } catch (error) {
      showBootError(error);
    }
  }

  function bootLoop() {
    try {
      boot();
    } catch (error) {
      showBootError(error);
    }
  }

  bootLoop();
  window.addEventListener('DOMContentLoaded', bootLoop);
  window.addEventListener('load', bootLoop);
  setInterval(bootLoop, 1000);
  new MutationObserver(bootLoop).observe(document.documentElement || document, { childList: true, subtree: true });
})();
