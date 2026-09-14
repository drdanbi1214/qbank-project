// ==UserScript==
// @name         Allen PDF 수집 → KMLE JSON 내보내기
// @namespace    local.allen-kmle-json
// @version      0.10.3
// @description  Allen 과목 목차를 이어서 수집하고 모든 대제목을 과목별 KMLE JSON 하나로 내보냅니다.
// @match        *://allenslibrary.com/*
// @match        *://*.allenslibrary.com/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      media.allenslibrary.com
// @connect      s3.ap-northeast-2.amazonaws.com
// ==/UserScript==

(function () {
  'use strict';

  // Allen → PDF 문제집 수집 0.1.5가 쓰는 sessionStorage 키다.
  const STORAGE_KEY = 'allenPdfWorkbookItemsV1';
  const BUTTON_ID = 'allen-kmle-json-export';
  const START_BUTTON_ID = 'allen-kmle-start-first';
  const START_AFTER_MOVE_KEY = 'allenKmleStartAfterFirstV1';
  const SUBJECT_BUTTON_ID = 'allen-kmle-subject-crawl';
  const STATUS_ID = 'allen-kmle-status';
  const CRAWL_STATE_KEY = 'allenKmleSubjectCrawlV3';
  const SUBJECT_ITEMS_KEY = 'allenKmleSubjectItemsV1';
  const SUBJECT_CHECKPOINT_KEY = 'allenKmleSubjectCheckpointV1';
  const ORIGINAL_AUTOMATION_KEY = 'allenPdfKmleAutomationV1';
  const REQUIRED_ORIGINAL_VERSION = '0.1.7';
  let exporting = false;
  let crawlTicking = false;

  function workbook() {
    try {
      const rows = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function subjectItems() {
    try {
      const rows = JSON.parse(sessionStorage.getItem(SUBJECT_ITEMS_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function saveSubjectItems(rows) {
    sessionStorage.setItem(SUBJECT_ITEMS_KEY, JSON.stringify(rows));
  }

  function appendSubjectItems(rows) {
    const merged = subjectItems();
    const known = new Set(merged.map((item) => item.id));
    for (const item of rows) {
      if (!known.has(item.id)) {
        merged.push(item);
        known.add(item.id);
      }
    }
    saveSubjectItems(merged);
    return merged;
  }

  function subjectCheckpoint() {
    try {
      const value = JSON.parse(sessionStorage.getItem(SUBJECT_CHECKPOINT_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSubjectCheckpoint(value) {
    if (value) sessionStorage.setItem(SUBJECT_CHECKPOINT_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SUBJECT_CHECKPOINT_KEY);
    updateSubjectButton();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다.'));
      reader.readAsDataURL(blob);
    });
  }

  function normalizeImageBlob(blob, url) {
    if (String(blob.type || '').startsWith('image/')) return blob;
    const extension = new URL(url, location.href).pathname.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      avif: 'image/avif',
      gif: 'image/gif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      webp: 'image/webp',
    };
    const type = mimeTypes[extension] || blob.type || 'application/octet-stream';
    return new Blob([blob], { type });
  }

  function downloadImageBlob(url) {
    const target = new URL(url, location.href);
    if (target.origin === location.origin || typeof GM_xmlhttpRequest !== 'function') {
      return fetch(target.href, { credentials: 'include' }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob().then((blob) => normalizeImageBlob(blob, target.href));
      });
    }

    // Allen의 이미지는 별도 media 서브도메인에 있어 페이지 fetch가 CORS로
    // 차단된다. Tampermonkey의 권한 요청을 사용하면 원본 이미지를 JSON 안에
    // data URL로 안전하게 포함할 수 있다.
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: target.href,
        responseType: 'blob',
        timeout: 30000,
        onload: (response) => {
          const status = Number(response.status || 0);
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status || '응답 없음'}`));
            return;
          }
          if (response.response instanceof Blob) {
            resolve(normalizeImageBlob(response.response, target.href));
            return;
          }
          reject(new Error('이미지 응답을 Blob으로 받지 못했습니다.'));
        },
        onerror: (error) => reject(new Error(error?.error || error?.details || '이미지 요청 실패')),
        ontimeout: () => reject(new Error('이미지 요청 시간 초과')),
      });
    });
  }

  async function inlineImages(html, baseUrl, failures) {
    if (!html) return '';
    const documentCopy = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    const images = [...documentCopy.querySelectorAll('main img')];
    for (const image of images) {
      const raw = image.getAttribute('src') || '';
      if (!raw || raw.startsWith('data:')) continue;
      try {
        const absolute = new URL(raw, baseUrl || location.href).href;
        image.setAttribute('src', await blobToDataUrl(await downloadImageBlob(absolute)));
      } catch (error) {
        failures.push(`${raw}: ${error?.message || error}`);
      }
    }
    return documentCopy.querySelector('main')?.innerHTML || html;
  }

  function safeFilePart(value) {
    return String(value || 'kmle').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
  }

  function visible(element) {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function pagerInput() {
    return [...document.querySelectorAll('input')].find((input) => {
      if (!visible(input) || !/^\d+$/.test(String(input.value || '').trim())) return false;
      let container = input.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        if (/\/\s*\d+/.test(container.innerText || '')) return true;
      }
      return false;
    }) || null;
  }

  function pageNumber() {
    const input = pagerInput();
    return input ? Number.parseInt(input.value, 10) : null;
  }

  function pagePosition() {
    const input = pagerInput();
    if (!input) return null;
    let container = input.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const match = (container.innerText || '').match(/\/\s*(\d+)/);
      if (match) return { current: Number.parseInt(input.value, 10), total: Number.parseInt(match[1], 10) };
    }
    return null;
  }

  function previousQuestionUrl() {
    const input = pagerInput();
    const position = pagePosition();
    if (!input || !position || position.current <= 1) return null;
    const chapterMatch = location.pathname.match(/^(\/study\/chapter\/[^/]+\/problem\/)[^/?#]+/);
    if (!chapterMatch) return null;

    // 페이지 번호와 화살표가 생각보다 먼 상위 요소에 놓이는 화면이 있어 문서
    // 전체에서 현재 단원의 문제 링크만 찾는다.
    const links = [...document.querySelectorAll('a[href]')]
      .filter((link) => {
        try {
          const url = new URL(link.href, location.href);
          return url.origin === location.origin
            && url.pathname.startsWith(chapterMatch[1])
            && url.href !== location.href;
        } catch (_) {
          return false;
        }
      });
    if (!links.length) return null;

    const explicitlyPrevious = links.find((link) => /이전/.test([
      link.getAttribute('aria-label'),
      link.getAttribute('title'),
      link.innerText,
    ].filter(Boolean).join(' ')));
    if (explicitlyPrevious) return explicitlyPrevious.href;

    // 아이콘뿐인 링크는 이름이 DOM 속성에 없을 수 있다. 입력칸 왼쪽에 있는 링크를
    // 우선하고, 그것도 판별되지 않으면 문서 순서상 첫 문제 링크를 사용한다.
    const inputBox = input.getBoundingClientRect();
    const leftLink = links
      .filter((link) => link.getBoundingClientRect().right <= inputBox.left + 4)
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    return (leftLink || links[0]).href;
  }

  function clickOriginalAuto() {
    const auto = document.getElementById('allen-pdf-auto');
    if (!auto) {
      alert('Allen PDF 수집 스크립트 0.1.7을 함께 켜 주세요.');
      return false;
    }
    auto.click();
    return true;
  }

  function startFromFirst() {
    const input = pagerInput();
    if (!input) {
      alert('문제 화면의 페이지 번호 입력칸을 찾지 못했습니다. Q 숫자/숫자 버튼으로 문제 화면에 들어간 뒤 다시 눌러 주세요.');
      return;
    }
    if (pageNumber() === 1) {
      clickOriginalAuto();
      return;
    }

    const previousUrl = previousQuestionUrl();
    if (!previousUrl) {
      alert('이전 문제 주소를 찾지 못했습니다.');
      return;
    }
    sessionStorage.setItem(START_AFTER_MOVE_KEY, '1');
    location.assign(previousUrl);
  }

  function resumeAfterFirstPageMove() {
    const raw = sessionStorage.getItem(START_AFTER_MOVE_KEY);
    if (!raw) return;
    if (pageNumber() !== 1) {
      const previousUrl = previousQuestionUrl();
      if (!previousUrl) {
        sessionStorage.removeItem(START_AFTER_MOVE_KEY);
        alert('1번으로 이동하는 중 이전 문제 주소를 찾지 못했습니다.');
        return;
      }
      location.assign(previousUrl);
      return;
    }
    const auto = document.getElementById('allen-pdf-auto');
    if (!auto) return;
    sessionStorage.removeItem(START_AFTER_MOVE_KEY);
    setTimeout(() => auto.click(), 400);
  }

  function sanitizeQuestion(value) {
    const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    while (lines.length && /^(?:조건 해석|A-|A\+|\d{1,2}px)$/.test(lines[0])) lines.shift();
    return lines.join('\n');
  }

  function crawlState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(CRAWL_STATE_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveCrawlState(value) {
    if (value) sessionStorage.setItem(CRAWL_STATE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(CRAWL_STATE_KEY);
    updateSubjectButton();
  }

  function chapterTitleFor(button) {
    let container = button.parentElement;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      const lines = (container.innerText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.some((line) => /^이론\s*\d+개$/.test(line))) continue;
      return lines.find((line) => (
        line !== button.innerText.trim()
        && !/^\d{1,2}$/.test(line)
        && !/^이론\s*\d+개$/.test(line)
        && !/^Q\s*\d+\s*\/\s*\d+$/.test(line)
      )) || '';
    }
    return '';
  }

  function tocEntries() {
    return [...document.querySelectorAll('button, a')]
      .filter((element) => visible(element) && /^Q\s*\d+\s*\/\s*\d+$/.test(element.innerText.trim()))
      .map((button) => {
        const match = button.innerText.trim().match(/^Q\s*\d+\s*\/\s*(\d+)$/);
        return {
          button,
          title: chapterTitleFor(button),
          total: Number.parseInt(match?.[1] || '0', 10),
        };
      })
      .filter((entry) => entry.title);
  }

  function subjectTitle() {
    const titleMatch = document.title.match(/^학습하기\s*-\s*(.+?)\s*\|\s*알렌의 서재$/);
    if (titleMatch?.[1]) return titleMatch[1].trim();
    const pathnameMatch = location.pathname.match(/\/study\/toc\/(\d+)/);
    return pathnameMatch ? `과목_${pathnameMatch[1]}` : '과목_전체';
  }

  function suppressAutoAlerts() {
    sessionStorage.setItem(ORIGINAL_AUTOMATION_KEY, '1');
  }

  function restoreAutoAlerts() {
    sessionStorage.removeItem(ORIGINAL_AUTOMATION_KEY);
  }

  function stopSubjectCrawl(message) {
    const auto = document.getElementById('allen-pdf-auto');
    if (auto?.textContent?.includes('중단')) auto.click();
    restoreAutoAlerts();
    saveCrawlState(null);
    const checkpoint = subjectCheckpoint();
    if (message) {
      alert(checkpoint
        ? `${message}\n\n완료된 ${checkpoint.nextIndex}/${checkpoint.total}개 대제목과 ${subjectItems().length}문항은 남아 있습니다.\n목차에서 KMLE 이어서 수집을 누르면 다음 대제목부터 계속합니다.`
        : message);
    }
  }

  function updateSubjectButton() {
    const button = document.getElementById(SUBJECT_BUTTON_ID);
    const state = crawlState();
    const checkpoint = subjectCheckpoint();
    const resumable = !state && checkpoint && subjectItems().length > 0;
    if (button) {
      button.textContent = state
        ? `KMLE 전체 중단 (${Math.min(state.index + 1, state.total)}/${state.total})`
        : resumable
          ? `KMLE 이어서 수집 (${checkpoint.nextIndex}/${checkpoint.total})`
          : 'KMLE 과목 전체 수집';
    }
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    if (!state) {
      status.innerHTML = resumable
        ? `<b>KMLE 이어하기 가능</b><br>${checkpoint.nextIndex}/${checkpoint.total}개 대제목 완료<br>${subjectItems().length}문항 보관 중`
        : '<b>KMLE 대기</b><br>목차에서 과목 전체 수집을 누르세요.';
      return;
    }
    const labels = {
      toc: '다음 대제목 준비',
      entering: '문제 화면 진입',
      'moving-first': '1번 문제로 이동',
      'ready-first': '1번 문제 확인',
      collecting: '문제 수집 중',
      accumulating: '대제목 수집 결과 합치는 중',
      saving: '과목 전체 JSON 저장 중',
      returning: '목차로 돌아가는 중',
    };
    status.innerHTML = [
      `<b>KMLE ${Math.min(state.index + 1, state.total)}/${state.total}단원</b>`,
      state.chapter ? escapeText(state.chapter) : '',
      labels[state.phase] || escapeText(state.phase || ''),
      `수집 완료 ${state.saved || 0}/${state.expected || '?'}문항`,
    ].filter(Boolean).join('<br>');
  }

  function escapeText(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function startSubjectCrawl() {
    const running = crawlState();
    if (running) {
      stopSubjectCrawl('KMLE 과목 전체 수집을 중단했습니다. 지금까지 모은 문제는 남아 있습니다.');
      return;
    }
    const entries = tocEntries();
    if (!entries.length) {
      alert('과목 목차 화면에서 실행해 주세요.');
      return;
    }
    const accumulated = subjectItems();
    let checkpoint = subjectCheckpoint();
    if (!checkpoint && accumulated.length > 0) {
      const completedTitles = new Set(accumulated.map((item) => item.chapter).filter(Boolean));
      let nextIndex = 0;
      while (nextIndex < entries.length && completedTitles.has(entries[nextIndex].title)) nextIndex += 1;
      if (nextIndex > 0) {
        checkpoint = {
          tocUrl: location.href,
          subject: subjectTitle(),
          nextIndex,
          total: entries.length,
          expected: entries.reduce((sum, entry) => sum + entry.total, 0),
          countNotes: [],
          updatedAt: Date.now(),
        };
        saveSubjectCheckpoint(checkpoint);
      }
    }
    const canResume = checkpoint
      && accumulated.length > 0
      && checkpoint.tocUrl === location.href
      && checkpoint.nextIndex <= entries.length;
    if (canResume) {
      const resume = confirm([
        '이전에 완료한 과목 수집을 이어서 진행할까요?',
        '',
        `완료: ${checkpoint.nextIndex}/${entries.length}개 대제목`,
        `보관: ${accumulated.length}문항`,
        checkpoint.nextIndex < entries.length ? `다음: ${entries[checkpoint.nextIndex].title}` : '다음: 과목 JSON 저장',
        '',
        '확인: 이어서 수집',
        '취소: 그대로 보관',
      ].join('\n'));
      if (!resume) return;
      sessionStorage.setItem(STORAGE_KEY, '[]');
      saveCrawlState({
        tocUrl: location.href,
        subject: checkpoint.subject || subjectTitle(),
        index: checkpoint.nextIndex,
        total: entries.length,
        expected: checkpoint.expected || entries.reduce((sum, entry) => sum + entry.total, 0),
        saved: accumulated.length,
        attempt: 0,
        phase: 'toc',
        chapter: '',
        countNotes: checkpoint.countNotes || [],
        phaseStartedAt: Date.now(),
      });
      return;
    }
    if (checkpoint || accumulated.length) {
      saveSubjectCheckpoint(null);
      saveSubjectItems([]);
    }
    const saved = workbook().length;
    const message = [
      `이 과목의 ${entries.length}개 대제목을 차례로 수집합니다.`,
      '각 대제목은 1번 문제부터 시작합니다.',
      `전체 ${entries.reduce((sum, entry) => sum + entry.total, 0)}문항을 모두 확인한 뒤 과목 JSON 하나를 저장합니다.`,
      saved ? `현재 임시 저장된 ${saved}문항은 비우고 시작합니다.` : '',
      '',
      '수집을 시작할까요?',
    ].filter(Boolean).join('\n');
    if (!confirm(message)) return;

    sessionStorage.setItem(STORAGE_KEY, '[]');
    saveSubjectItems([]);
    saveSubjectCheckpoint(null);
    saveCrawlState({
      tocUrl: location.href,
      subject: subjectTitle(),
      index: 0,
      total: entries.length,
      expected: entries.reduce((sum, entry) => sum + entry.total, 0),
      saved: 0,
      attempt: 0,
      phase: 'toc',
      chapter: '',
      phaseStartedAt: Date.now(),
    });
  }

  function startOriginalAutoForCrawl(state) {
    const auto = document.getElementById('allen-pdf-auto');
    const originalVersion = document.getElementById('allen-pdf-tools')?.dataset?.version;
    if (!auto || originalVersion !== REQUIRED_ORIGINAL_VERSION) {
      throw new Error(`Allen PDF 수집 스크립트 ${REQUIRED_ORIGINAL_VERSION}을 함께 켜 주세요. 현재: ${originalVersion || '없음'}`);
    }
    suppressAutoAlerts();
    auto.click();
    saveCrawlState({ ...state, phase: 'collecting', phaseStartedAt: Date.now() });
  }

  async function finishSubjectCrawl(state) {
    restoreAutoAlerts();
    const rows = subjectItems();
    if (!rows.length) throw new Error('과목 전체로 모인 문제가 없습니다.');
    saveCrawlState({ ...state, phase: 'saving', phaseStartedAt: Date.now() });
    const result = await exportKmle(false, rows, state.subject || '과목_전체');
    sessionStorage.removeItem(SUBJECT_ITEMS_KEY);
    saveSubjectCheckpoint(null);
    saveCrawlState(null);
    alert([
      'KMLE 과목 전체 수집 완료',
      result.filename,
      `대제목 ${state.total}개 · 문제 ${rows.length}개`,
      ...(state.countNotes || []),
      result.failures ? `이미지 포함 실패 ${result.failures}개` : '이미지도 모두 포함했습니다.',
    ].join('\n'));
  }

  async function runCrawlTick() {
    if (crawlTicking) return;
    const state = crawlState();
    if (!state) return;
    crawlTicking = true;
    try {
      const entries = tocEntries();
      if (entries.length) {
        restoreAutoAlerts();
        if (state.index >= state.total || state.index >= entries.length) {
          await finishSubjectCrawl(state);
          return;
        }
        if (state.phase !== 'toc') {
          saveCrawlState({ ...state, phase: 'toc', phaseStartedAt: Date.now() });
          return;
        }
        const entry = entries[state.index];
        saveCrawlState({
          ...state,
          chapter: entry.title,
          chapterExpected: entry.total,
          phase: 'entering',
          phaseStartedAt: Date.now(),
        });
        entry.button.click();
        return;
      }

      const position = pagePosition();
      if (!position) {
        if (Date.now() - state.phaseStartedAt > 12000) throw new Error('문제 화면이나 페이지 번호 입력칸을 찾지 못했습니다.');
        return;
      }

      if (state.phase === 'entering' || state.phase === 'moving-first') {
        if (position.total > 0 && position.total !== state.chapterExpected) {
          state.expected = Math.max(0, Number(state.expected || 0) - Number(state.chapterExpected || 0) + position.total);
          state.chapterExpected = position.total;
          saveCrawlState({ ...state });
        }
        if (position.current !== 1) {
          const previousUrl = previousQuestionUrl();
          if (!previousUrl) throw new Error(`${position.current}번에서 이전 문제 주소를 찾지 못했습니다.`);
          saveCrawlState({ ...state, phase: 'moving-first', phaseStartedAt: Date.now() });
          location.assign(previousUrl);
          return;
        }
        const answerControl = [...document.querySelectorAll('button')]
          .find((button) => visible(button) && /^(정답 확인|해설 닫기)$/.test(button.innerText.trim()));
        if (!answerControl) {
          if (Date.now() - state.phaseStartedAt > 12000) throw new Error('1번 문제 본문이 준비되지 않았습니다.');
          return;
        }
        saveCrawlState({ ...state, phase: 'ready-first', phaseStartedAt: Date.now() });
        return;
      }

      if (state.phase === 'ready-first') {
        if (position.current !== 1) throw new Error('자동 수집을 시작하기 전에 1번 문제에서 벗어났습니다.');
        if (Date.now() - state.phaseStartedAt < 1800) return;
        const answerControl = [...document.querySelectorAll('button')]
          .find((button) => visible(button) && /^(정답 확인|해설 닫기)$/.test(button.innerText.trim()));
        if (!answerControl) throw new Error('정답 확인 버튼을 찾지 못했습니다.');
        startOriginalAutoForCrawl(state);
        return;
      }

      if (state.phase === 'collecting') {
        const auto = document.getElementById('allen-pdf-auto');
        const isRunning = auto?.textContent?.includes('중단');
        if (isRunning || Date.now() - state.phaseStartedAt < 1500) return;

        const progress = document.getElementById('allen-pdf-progress')?.innerText || '';
        if (/실패\s*[1-9]/.test(progress)) {
          if ((state.attempt || 0) < 1) {
            restoreAutoAlerts();
            sessionStorage.setItem(STORAGE_KEY, '[]');
            saveCrawlState({
              ...state,
              attempt: (state.attempt || 0) + 1,
              phase: 'returning',
              phaseStartedAt: Date.now(),
            });
            location.assign(state.tocUrl);
            return;
          }
          throw new Error(`${state.chapter} 수집 중 재시도 후에도 문제가 발생했습니다. ${progress}`);
        }
        if (position.current !== position.total) {
          throw new Error(`${state.chapter}가 ${position.current}/${position.total}에서 일찍 멈췄습니다.`);
        }

        restoreAutoAlerts();
        const chapterCount = workbook().length;
        if (!chapterCount) throw new Error(`${state.chapter}에서 저장된 문제가 없습니다.`);
        const countNotes = [...(state.countNotes || [])];
        if (state.chapterExpected && chapterCount !== state.chapterExpected) {
          const direction = chapterCount > state.chapterExpected ? '더 많이' : '적게';
          countNotes.push(`${state.chapter}: 화면 ${state.chapterExpected}개보다 ${Math.abs(chapterCount - state.chapterExpected)}개 ${direction} 저장`);
        }
        saveCrawlState({ ...state, phase: 'accumulating', phaseStartedAt: Date.now() });
        const accumulated = appendSubjectItems(workbook());
        sessionStorage.setItem(STORAGE_KEY, '[]');
        const nextIndex = state.index + 1;
        const adjustedExpected = Math.max(
          accumulated.length,
          Number(state.expected || 0) - Number(state.chapterExpected || 0) + chapterCount,
        );
        saveSubjectCheckpoint({
          tocUrl: state.tocUrl,
          subject: state.subject,
          nextIndex,
          total: state.total,
          expected: adjustedExpected,
          countNotes,
          updatedAt: Date.now(),
        });
        saveCrawlState({
          ...state,
          index: nextIndex,
          expected: adjustedExpected,
          saved: accumulated.length,
          attempt: 0,
          countNotes,
          phase: 'returning',
          phaseStartedAt: Date.now(),
        });
        location.assign(state.tocUrl);
      }
    } catch (error) {
      console.error('[KMLE 과목 전체 수집]', error);
      stopSubjectCrawl(`KMLE 과목 전체 수집 중단\n${error?.message || error}`);
    } finally {
      crawlTicking = false;
    }
  }

  function downloadJson(data, chapter) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const filename = `kmle_${safeFilePart(chapter)}_${new Date().toISOString().slice(0, 10)}.json`;
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== 'function') {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('Tampermonkey 다운로드 권한을 사용할 수 없습니다. 스크립트 권한을 다시 승인해 주세요.'));
        return;
      }
      GM_download({
        url: blobUrl,
        name: filename,
        saveAs: false,
        onload: () => {
          URL.revokeObjectURL(blobUrl);
          resolve(filename);
        },
        onerror: (error) => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error(`JSON 다운로드 실패: ${error?.error || error?.details || '알 수 없는 오류'}`));
        },
        ontimeout: () => {
          URL.revokeObjectURL(blobUrl);
          reject(new Error('JSON 다운로드 시간이 초과되었습니다.'));
        },
      });
    });
  }

  async function exportKmle(showAlert = true, sourceRows = null, downloadTitle = '') {
    if (exporting) return;
    const currentRows = workbook();
    const accumulatedRows = subjectItems();
    const rows = sourceRows || (currentRows.length ? currentRows : accumulatedRows);
    if (!rows.length) {
      alert('먼저 기존 PDF 수집 버튼으로 문제를 모아 주세요.');
      return;
    }

    exporting = true;
    const button = document.getElementById(BUTTON_ID);
    if (button) button.textContent = '이미지 포함 중…';
    const failures = [];
    try {
      const items = [];
      for (let index = 0; index < rows.length; index += 1) {
        if (button) button.textContent = `JSON 준비 ${index + 1}/${rows.length}`;
        const item = rows[index];
        items.push({
          ...item,
          question: sanitizeQuestion(item.question),
          contentHtml: await inlineImages(item.contentHtml, item.url, failures),
          explanationAssetsHtml: await inlineImages(item.explanationAssetsHtml, item.url, failures),
        });
      }
      const chapters = new Set(items.map((item) => item.chapter).filter(Boolean));
      const filename = await downloadJson({
        schema: 'qbank-kmle-v1',
        exportedAt: new Date().toISOString(),
        items,
        imageFailures: failures,
      }, downloadTitle || (chapters.size === 1 ? items[0]?.chapter : '과목_전체'));

      const result = { filename, count: items.length, failures: failures.length };
      if (showAlert) {
        if (failures.length) {
          alert(`KMLE JSON을 저장했습니다.\n${filename}\n문제 ${items.length}개\n이미지 포함 실패 ${failures.length}개\n\n실패 목록은 JSON의 imageFailures에 들어 있습니다.`);
        } else {
          alert(`KMLE JSON 저장 완료\n${filename}\n문제 ${items.length}개\n이미지도 모두 포함했습니다.`);
        }
      }
      return result;
    } finally {
      exporting = false;
      if (button) button.textContent = 'KMLE JSON 저장';
    }
  }

  function addButton() {
    const host = document.getElementById('allen-pdf-tools');
    if (!host) return;
    const progress = document.getElementById('allen-pdf-progress');

    if (!document.getElementById(STATUS_ID)) {
      const status = document.createElement('div');
      status.id = STATUS_ID;
      status.style.cssText = 'order:98;padding:8px 9px;border:1px solid #C4B5FD;border-radius:9px;background:#F5F3FF;color:#6D28D9;font-size:11px;line-height:1.45;text-align:left;box-shadow:0 2px 10px #0002';
      host.insertBefore(status, progress || null);
    }

    if (tocEntries().length && !document.getElementById(SUBJECT_BUTTON_ID)) {
      const subjectButton = document.createElement('button');
      subjectButton.id = SUBJECT_BUTTON_ID;
      subjectButton.type = 'button';
      subjectButton.style.cssText = 'width:142px;padding:9px 8px;border:1px solid #0EA5E9;border-radius:9px;background:#F0F9FF;color:#0369A1;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 2px 10px #0002;white-space:nowrap';
      subjectButton.addEventListener('click', startSubjectCrawl);
      host.insertBefore(subjectButton, progress || null);
    }

    if (!document.getElementById(START_BUTTON_ID)) {
      const startButton = document.createElement('button');
      startButton.id = START_BUTTON_ID;
      startButton.type = 'button';
      startButton.textContent = 'KMLE 1번부터 수집';
      startButton.style.cssText = 'width:142px;padding:9px 8px;border:1px solid #34D399;border-radius:9px;background:#ECFDF5;color:#047857;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 2px 10px #0002;white-space:nowrap';
      startButton.addEventListener('click', startFromFirst);
      host.insertBefore(startButton, progress || null);
    }

    if (!document.getElementById(BUTTON_ID)) {
      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.textContent = 'KMLE JSON 저장';
      button.style.cssText = 'width:142px;padding:9px 8px;border:1px solid #A78BFA;border-radius:9px;background:#F3E8FF;color:#6D28D9;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 2px 10px #0002;white-space:nowrap';
      button.addEventListener('click', () => void exportKmle());
      host.insertBefore(button, progress || null);
    }
    resumeAfterFirstPageMove();
    updateSubjectButton();
  }

  addButton();
  setInterval(() => {
    addButton();
    void runCrawlTick();
  }, 1000);
})();
