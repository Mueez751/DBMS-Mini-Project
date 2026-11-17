import { redirect } from 'next/navigation';
import Nav from '@/components/Nav';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Every page in this group needs a signed-in user. The middleware already checked the cookie;
// this re-checks against the database so a deleted account cannot see the pages either.
export default async function AppLayout({ children }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <>
      <Nav user={{ email: user.email, role: user.role }} />
      <main className="page">{children}</main>
    </>
  );
}
