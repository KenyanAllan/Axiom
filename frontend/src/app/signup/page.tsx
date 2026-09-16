"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserPlus, Eye, EyeOff } from "lucide-react";
import { useDemoUser } from "@/hooks/use-demo-user";

export default function SignupPage() {
  const router = useRouter();
  const { allUsers, signup } = useDemoUser();
  const [displayName, setDisplayName] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  // Auto-generate user ID from display name
  const handleNameChange = (name: string) => {
    setDisplayName(name);
    if (!userId || userId.startsWith("usr_")) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      setUserId(slug ? `usr_${slug}` : "");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!displayName.trim()) {
      setError("Please enter your display name.");
      return;
    }
    if (!userId.trim()) {
      setError("Please enter a user ID.");
      return;
    }
    if (allUsers[userId.trim()]) {
      setError("That user ID is already taken. Try a different one.");
      return;
    }

    signup(userId.trim(), displayName.trim(), role);
    router.push("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 px-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            Ax
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            Create your Axiom account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start your learning journey
          </p>
        </div>

        {/* Signup form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="displayName"
              className="mb-1.5 block text-sm font-medium"
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Sam Richards"
              className="w-full rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

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
              placeholder="usr_sam_richards"
              className="w-full rounded-lg border bg-background px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Used for authentication. Auto-generated from your name.
            </p>
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

          {/* Role selector */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Role</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole("student")}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  role === "student"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent"
                }`}
              >
                <p className="text-sm font-semibold">Student</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Learn through diagnostics and activities
                </p>
              </button>
              <button
                type="button"
                onClick={() => setRole("teacher")}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  role === "teacher"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "hover:bg-accent"
                }`}
              >
                <p className="text-sm font-semibold">Teacher</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Create classrooms and manage content
                </p>
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
            <UserPlus className="h-4 w-4" />
            Create Account
          </button>
        </form>

        {/* Login link */}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:text-primary/80"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
