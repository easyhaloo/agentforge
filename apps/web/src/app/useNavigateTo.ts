import { useLocation, useNavigate } from "react-router-dom";

/** navigate() that replaces the history entry when the target is the page already shown, as <Link> does. */
export function useNavigateTo() {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const current = pathname + search + hash;
  return (to: string) => navigate(to, { replace: to === current });
}
