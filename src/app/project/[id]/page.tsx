"use client";

import { use } from "react";
import { ProjectView } from "@/components/fv/ProjectView";
import { useFavourAuth } from "@/hooks/useFavourAuth";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const auth = useFavourAuth();
  if (!auth.checked) return null;
  return <ProjectView id={id} userId={auth.userId} isInWorldApp={auth.isInWorldApp} isVerifying={auth.isVerifying} authError={auth.authError} onVerify={auth.signIn} />;
}
