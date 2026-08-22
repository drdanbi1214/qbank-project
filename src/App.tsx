import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAvatar } from '@/components/layout/RequireAvatar'
import { StudyLayout } from '@/components/layout/StudyLayout'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { AuthProvider } from '@/lib/auth'
import { DataProvider } from '@/lib/data'
import { NotificationProvider } from '@/lib/notifications'
import { ThemeProvider } from '@/lib/theme'
import { AdminRoute, ApprovedRoute, ProtectedRoute } from '@/routes/ProtectedRoute'

// Route modules are deliberately loaded only when visited. In particular, the
// login and study screens no longer download every admin/editor page up front.
const AdminAssignmentsPage = lazy(() => import('@/pages/AdminAssignmentsPage').then((m) => ({ default: m.AdminAssignmentsPage })))
const AdminHomePage = lazy(() => import('@/pages/AdminHomePage').then((m) => ({ default: m.AdminHomePage })))
const AdminLabelingPage = lazy(() => import('@/pages/AdminLabelingPage').then((m) => ({ default: m.AdminLabelingPage })))
const AdminQuestionsPage = lazy(() => import('@/pages/AdminQuestionsPage').then((m) => ({ default: m.AdminQuestionsPage })))
const AdminReportsPage = lazy(() => import('@/pages/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage })))
const AdminReviewPage = lazy(() => import('@/pages/AdminReviewPage').then((m) => ({ default: m.AdminReviewPage })))
const AdminRevisionsPage = lazy(() => import('@/pages/AdminRevisionsPage').then((m) => ({ default: m.AdminRevisionsPage })))
const AdminStatsPage = lazy(() => import('@/pages/AdminStatsPage').then((m) => ({ default: m.AdminStatsPage })))
const AdminUploadPage = lazy(() => import('@/pages/AdminUploadPage').then((m) => ({ default: m.AdminUploadPage })))
const AdminUsersPage = lazy(() => import('@/pages/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })))
const AdminVisibilityPage = lazy(() => import('@/pages/AdminVisibilityPage').then((m) => ({ default: m.AdminVisibilityPage })))
const AnnouncementsPage = lazy(() => import('@/pages/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })))
const BlockTestPage = lazy(() => import('@/pages/BlockTestPage').then((m) => ({ default: m.BlockTestPage })))
const DiscussionsPage = lazy(() => import('@/pages/DiscussionsPage').then((m) => ({ default: m.DiscussionsPage })))
const ExamDetailPage = lazy(() => import('@/pages/ExamDetailPage').then((m) => ({ default: m.ExamDetailPage })))
const ExamsPage = lazy(() => import('@/pages/ExamsPage').then((m) => ({ default: m.ExamsPage })))
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const MyAssignmentsPage = lazy(() => import('@/pages/MyAssignmentsPage').then((m) => ({ default: m.MyAssignmentsPage })))
const MyPage = lazy(() => import('@/pages/MyPage').then((m) => ({ default: m.MyPage })))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const PendingApprovalPage = lazy(() => import('@/pages/PendingApprovalPage').then((m) => ({ default: m.PendingApprovalPage })))
const PrintPage = lazy(() => import('@/pages/PrintPage').then((m) => ({ default: m.PrintPage })))
const ProfilesPage = lazy(() => import('@/pages/ProfilesPage').then((m) => ({ default: m.ProfilesPage })))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })))
const SolvePage = lazy(() => import('@/pages/SolvePage').then((m) => ({ default: m.SolvePage })))
const StudyHomePage = lazy(() => import('@/pages/StudyHomePage').then((m) => ({ default: m.StudyHomePage })))
const SubjectPage = lazy(() => import('@/pages/SubjectPage').then((m) => ({ default: m.SubjectPage })))
const TheoryIndexPage = lazy(() => import('@/pages/TheoryIndexPage').then((m) => ({ default: m.TheoryIndexPage })))
const TheorySubjectPage = lazy(() => import('@/pages/TheorySubjectPage').then((m) => ({ default: m.TheorySubjectPage })))
const TopicIndexPage = lazy(() => import('@/pages/TopicIndexPage').then((m) => ({ default: m.TopicIndexPage })))
const TopicNoticesPage = lazy(() => import('@/pages/TopicNoticesPage').then((m) => ({ default: m.TopicNoticesPage })))
const TopicsPage = lazy(() => import('@/pages/TopicsPage').then((m) => ({ default: m.TopicsPage })))
const UnitQuestionsPage = lazy(() => import('@/pages/UnitQuestionsPage').then((m) => ({ default: m.UnitQuestionsPage })))
const WrongNotesPage = lazy(() => import('@/pages/WrongNotesPage').then((m) => ({ default: m.WrongNotesPage })))
const NotFoundPage = lazy(() => import('@/pages/placeholders').then((m) => ({ default: m.NotFoundPage })))

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>
              <DataProvider>
                <Suspense fallback={<FullPageSpinner />}>
                  <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />

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
                          <Route path="/theory" element={<TheoryIndexPage />} />
                          <Route path="/theory/:subjectId" element={<TheorySubjectPage />} />
                          <Route path="/theory/:subjectId/:documentId" element={<TheorySubjectPage />} />
                          {/* 테마는 스터디 권한이 있어야 열린다. 가드는 페이지 안에서 한다. */}
                          <Route path="/topics" element={<TopicIndexPage />} />
                          <Route path="/topics/notices" element={<TopicNoticesPage />} />
                          <Route path="/topics/:subjectId" element={<TopicsPage />} />
                          <Route path="/topics/:subjectId/:topicId" element={<TopicsPage />} />
                          <Route path="/exams/:examId" element={<ExamDetailPage />} />
                          <Route path="/assignments" element={<MyAssignmentsPage />} />
                          <Route path="/wrong-notes" element={<WrongNotesPage />} />
                          <Route path="/search" element={<SearchPage />} />
                          <Route path="/discussions" element={<DiscussionsPage />} />
                          <Route path="/announcements" element={<AnnouncementsPage />} />
                          <Route path="/notifications" element={<NotificationsPage />} />
                          <Route path="/me" element={<MyPage />} />
                          <Route path="/profiles" element={<ProfilesPage />} />

                          <Route element={<AdminRoute />}>
                            <Route path="/admin" element={<AdminHomePage />} />
                            <Route path="/admin/assignments" element={<AdminAssignmentsPage />} />
                            <Route path="/admin/questions" element={<AdminQuestionsPage />} />
                            <Route path="/admin/labeling" element={<AdminLabelingPage />} />
                            <Route path="/admin/review" element={<AdminReviewPage />} />
                            <Route path="/admin/upload" element={<AdminUploadPage />} />
                            <Route path="/admin/users" element={<AdminUsersPage />} />
                            <Route path="/admin/visibility" element={<AdminVisibilityPage />} />
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
                </Suspense>
              </DataProvider>
            </NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
