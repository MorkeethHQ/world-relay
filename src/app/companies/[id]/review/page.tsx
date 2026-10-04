import { CompanyReview } from "@/components/CompanyReview";
export default async function CompanyReviewPage({ params }: { params: Promise<{ id: string }> }) {
  return <CompanyReview id={(await params).id} />;
}
