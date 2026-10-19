"use client";

import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { FeedbackForm } from "@/components/fv/FeedbackForm";
import { useFavourAuth } from "@/hooks/useFavourAuth";

function Inner({ id }: { id: string }) {
  const auth = useFavourAuth();
  const taskId = useSearchParams().get("task");
  if (!auth.checked) return null;
  return <FeedbackForm id={id} taskId={taskId} userId={auth.userId} isInWorldApp={auth.isInWorldApp} isVerifying={auth.isVerifying} authError={auth.authError} onVerify={auth.signIn} />;
}

export default function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={null}><Inner id={id} /></Suspense>;
}
