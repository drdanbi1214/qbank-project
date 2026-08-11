import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAvatar } from '@/components/layout/RequireAvatar'
import { StudyLayout } from '@/components/layout/StudyLayout'
import { AuthProvider } from '@/lib/auth'
import { DataProvider } from '@/lib/data'
import { NotificationProvider } from '@/lib/notifications'
import { ThemeProvider } from '@/lib/theme'
import { AdminAssignmentsPage } from '@/pages/AdminAssignmentsPage'
import { AdminGroupsPage } from '@/pages/AdminGroupsPage'
import { AdminHomePage } from '@/pages/AdminHomePage'
import { AdminLabelingPage } from '@/pages/AdminLabelingPage'
import { AdminQuestionsPage } from '@/pages/AdminQuestionsPage'
import { AdminReportsPage } from '@/pages/AdminReportsPage'
import { AdminReviewPage } from '@/pages/AdminReviewPage'
import { AdminRevisionsPage } from '@/pages/AdminRevisionsPage'
import { AdminStatsPage } from '@/pages/AdminStatsPage'
import { AdminUploadPage } from '@/pages/AdminUploadPage'
import { AdminUsersPage } from '@/pages/AdminUsersPage'
import { AnnouncementsPage } from '@/pages/AnnouncementsPage'
import { BlockTestPage } from '@/pages/BlockTestPage'
import { DiscussionsPage } from '@/pages/DiscussionsPage'
import { ExamDetailPage } from '@/pages/ExamDetailPage'
import { ExamsPage } from '@/pages/ExamsPage'
import { LoginPage } from '@/pages/LoginPage'
import { MyAssignmentsPage } from '@/pages/MyAssignmentsPage'
import { MyPage } from '@/pages/MyPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { PendingApprovalPage } from '@/pages/PendingApprovalPage'
import { PrintPage } from '@/pages/PrintPage'
import { SearchPage } from '@/pages/SearchPage'
import { SolvePage } from '@/pages/SolvePage'
import { StudyHomePage } from '@/pages/StudyHomePage'
import { SubjectPage } from '@/pages/SubjectPage'
import { UnitQuestionsPage } from '@/pages/UnitQuestionsPage'
import { WrongNotesPage } from '@/pages/WrongNotesPage'
import { NotFoundPage } from '@/pages/placeholders'
import { AdminRoute, ApprovedRoute, ProtectedRoute } from '@/routes/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>
              <DataProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  <Route element={<ProtectedRoute />}>
                    <Route path="/pending" element={<PendingApprovalPage />} />

                    <Route element={<ApprovedRoute />}>
                      <Route element={<RequireAvatar />}>
                        {/* 좌측 사이드바가 붙는 학습 화면 */}
                        <Route path="/study" element={<StudyLayout />}>
                          <Route index element={<StudyHomePage />} />
                          <Route path=":subjectId" element={<SubjectPage />} />
                          <Route path=":subjectId/:unitId" element={<UnitQuestionsPage />} />
                        </Route>

                        {/* 풀이 화면은 문제에 집중하도록 사이드바 없이 단독 */}
                        <Route path="/solve" element={<SolvePage />} />
                        <Route path="/block-test" element={<BlockTestPage />} />
                        {/* 인쇄 화면은 종이에 맞춰야 해서 레이아웃 없이 단독으로 연다 */}
                        <Route path="/print" element={<PrintPage />} />

                        <Route element={<AppLayout />}>
                          <Route index element={<Navigate to="/study" replace />} />
                          <Route path="/exams" element={<ExamsPage />} />
                          <Route path="/exams/:examId" element={<ExamDetailPage />} />
                          <Route path="/assignments" element={<MyAssignmentsPage />} />
                          <Route path="/wrong-notes" element={<WrongNotesPage />} />
                          <Route path="/search" element={<SearchPage />} />
                          <Route path="/discussions" element={<DiscussionsPage />} />
                          <Route path="/announcements" element={<AnnouncementsPage />} />
                          <Route path="/notifications" element={<NotificationsPage />} />
                          <Route path="/me" element={<MyPage />} />

                          <Route element={<AdminRoute />}>
                            <Route path="/admin" element={<AdminHomePage />} />
                            <Route path="/admin/assignments" element={<AdminAssignmentsPage />} />
                            <Route path="/admin/questions" element={<AdminQuestionsPage />} />
                            <Route path="/admin/labeling" element={<AdminLabelingPage />} />
                            <Route path="/admin/review" element={<AdminReviewPage />} />
                            <Route path="/admin/upload" element={<AdminUploadPage />} />
                            <Route path="/admin/groups" element={<AdminGroupsPage />} />
                            <Route path="/admin/users" element={<AdminUsersPage />} />
                            <Route path="/admin/reports" element={<AdminReportsPage />} />
                            <Route path="/admin/revisions" element={<AdminRevisionsPage />} />
                            <Route path="/admin/stats" element={<AdminStatsPage />} />
                          </Route>

                          <Route path="*" element={<NotFoundPage />} />
                        </Route>
                      </Route>
                    </Route>
                  </Route>
                </Routes>
              </DataProvider>
            </NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
