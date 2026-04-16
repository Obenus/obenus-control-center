import { withAuth } from "next-auth/middleware";

export default withAuth({
    pages: {
        signIn: "/login",
    },
});

export const config = {
    matcher: [
        "/dashboard/:path*",
        "/servers/:path*",
        "/settings/:path*",
        "/users/:path*",
        "/monitoring/:path*"
    ],
};
