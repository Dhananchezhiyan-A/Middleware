"use client";

import { Plug } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useEnrichment } from "@/lib/queries/automation";

export default function EnrichmentPage() {
  const enrichment = useEnrichment();

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Enrichment"
        description="Third-party data appended to leads during the ENRICHMENT stage, before scoring and routing."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Provider status</CardTitle>
          <CardDescription>
            What the pipeline can currently do in this stage — reported live by the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enrichment.isLoading ? (
            <Skeleton className="h-24" />
          ) : enrichment.error ? (
            <p className="text-xs text-destructive">{errorMessage(enrichment.error)}</p>
          ) : enrichment.data ? (
            enrichment.data.implemented ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Active providers:</p>
                <div className="flex flex-wrap gap-1.5">
                  {enrichment.data.providers.length > 0 ? (
                    enrichment.data.providers.map((provider) => (
                      <Badge key={provider} variant="outline">
                        {provider}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">No providers configured.</span>
                  )}
                </div>
                {enrichment.data.note ? (
                  <p className="text-xs text-muted-foreground">{enrichment.data.note}</p>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={<Plug className="size-5" />}
                title="No enrichment providers yet"
                description={
                  enrichment.data.note ??
                  "The enrichment stage runs as a no-op until a provider is connected — leads flow through unchanged."
                }
              />
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
