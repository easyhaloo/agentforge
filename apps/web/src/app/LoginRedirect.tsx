import { Navigate, useLocation } from "react-router-dom";

export function LoginRedirect() {
  const { pathname, search, hash } = useLocation();
  return <Navigate replace to={{ pathname: "/login", search: `?${new URLSearchParams({ return: pathname + search + hash })}` }} />;
}
