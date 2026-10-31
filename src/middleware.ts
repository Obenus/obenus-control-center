import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
    function middleware(req) {
        const role = (req.nextauth.token as any)?.role;
        const path = req.nextUrl.pathname;

        // Rutas solo ADMIN
        if (
            (path.startsWith("/users") ||
                path.startsWith("/nova") ||
                path.startsWith("/schedules") ||
                path.startsWith("/api/users") ||
                path.startsWith("/api/nova") ||
                path.startsWith("/api/settings") ||
                path.startsWith("/api/admin")) &&
            role !== "ADMIN"
        ) {
            if (path.startsWith("/api/")) {
                return new NextResponse("Forbidden", { status: 403 });
            }
            return NextResponse.redirect(new URL("/dashboard", req.url));
        }

        return NextResponse.next();
    },
    {
        pages: { signIn: "/login" },
        callbacks: {
            authorized: ({ token, req }) => {
                const path = req.nextUrl.pathname;
                // next-auth callbacks under /api/auth must remain public
                if (path.startsWith("/api/auth")) return true;
                return !!token;
            },
        },
    }
);

export const config = {
    matcher: [
        "/dashboard/:path*",
        "/servers/:path*",
        "/settings/:path*",
        "/users/:path*",
        "/monitoring/:path*",
        "/nova/:path*",
        "/schedules/:path*",
        "/schedules",
        "/api/servers/:path*",
        "/api/servers",
        "/api/tasks/:path*",
        "/api/tasks",
        "/api/users/:path*",
        "/api/users",
        "/api/settings/:path*",
        "/api/settings",
        "/api/nova/:path*",
        "/api/nova",
        "/api/admin/:path*",
        "/api/admin",
        "/api/account/:path*",
        "/api/account",
    ],
};
