"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { useDemoUser } from "@/hooks/use-demo-user";

export default function LoginPage() {
  const router = useRouter();
  const { allUsers, login } = useDemoUser();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = userId.trim();
    if (!trimmed) {
      setError("Please enter a user ID.");
      return;
    }

    if (!allUsers[trimmed]) {
      setError("User not found. Check the ID or sign up for a new account.");
      return;
    }

    // Demo auth — no real password check
    login(trimmed);
    router.push("/");
  };

  const handleDemoLogin = (id: string) => {
    login(id);
    router.push("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-primary text-4xl font-bold text-primary-foreground">
            Ax
          </div>
          <h1 className="mt-6 text-6xl font-bold tracking-tight">
            Axiom
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Sign in to your Technical Learning Workbench
          </p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="userId"
              className="mb-1.5 block text-sm font-medium"
            >
              User ID
            </label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. usr_student_demo"
              className="w-full rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Any value for demo"
                className="w-full rounded-lg border bg-background px-4 py-2.5 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            Sign In
          </button>
        </form>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or use a demo account
            </span>
          </div>
        </div>

        {/* Demo login buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleDemoLogin("usr_student_demo")}
            className="rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
          >
            <p className="text-sm font-semibold">Demo Student</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              usr_student_demo
            </p>
          </button>
          <button
            onClick={() => handleDemoLogin("usr_teacher_demo")}
            className="rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent"
          >
            <p className="text-sm font-semibold">Demo Teacher</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              usr_teacher_demo
            </p>
          </button>
        </div>

        {/* Signup link */}
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:text-primary/80"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
