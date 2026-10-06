"use client";

import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

/**
 * Duplicates overview is NOT wired yet: the API exposes duplicate relationships
 * per lead (GET /leads/:id → duplicateOf / duplicates) but no dedicated
 * collection endpoint. This page states that honestly instead of faking data.
 */
export default function DuplicatesPage() {
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Duplicates"
        description="Duplicate detection outcomes across the lead pipeline."
      />
      <Card>
        <EmptyState
          icon={<Scale className="size-5" />}
          title="Duplicate overview endpoint is scheduled for Phase 2"
          description={
            <>
              There is currently no collection endpoint for duplicate relationships, so this page
              cannot list them yet. Duplicates are surfaced today on each lead&apos;s detail page
              (the <span className="font-mono">duplicateOf</span> and{" "}
              <span className="font-mono">duplicates</span> sections). Open a lead from All Leads to
              inspect its duplicate links.
            </>
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/leads">
                  Browse all leads <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="/automation/deduplication">Deduplication settings</Link>
              </Button>
            </div>
          }
        />
      </Card>
    </div>
  );
}
