"use client";

import { LeadHeader } from "@/components/leads/detail/lead-header";
import { LeadOverview } from "@/components/leads/detail/lead-overview";
import { LeadPipeline } from "@/components/leads/detail/lead-pipeline";
import { LeadScores } from "@/components/leads/detail/lead-scores";
import { LeadDuplicates } from "@/components/leads/detail/lead-duplicates";
import { LeadRouting } from "@/components/leads/detail/lead-routing";
import { LeadDeliveries } from "@/components/leads/detail/lead-deliveries";
import { LeadAudit, LeadRawPayloads } from "@/components/leads/detail/lead-audit";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLead, useReplayLead } from "@/lib/queries/leads";

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 rounded-lg" />
      <Skeleton className="h-9 w-96 rounded-lg" />
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}

export function LeadDetail({ id }: { id: string }) {
  const { data: lead, isLoading, error, refetch } = useLead(id);
  const { can } = useAuth();
  const replay = useReplayLead();
  const { toast } = useToast();

  if (isLoading) return <DetailSkeleton />;
  if (error) {
    return (
      <Card>
        <ErrorState error={error} title="Could not load this lead" onRetry={() => void refetch()} />
      </Card>
    );
  }
  if (!lead) return null;

  const handleReplay = async () => {
    try {
      await replay.mutateAsync(lead.id);
      toast({
        title: "Replay queued",
        description: "The lead was requeued for processing.",
        variant: "success",
      });
      void refetch();
    } catch (err) {
      toast({ title: "Replay failed", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <LeadHeader
        lead={lead}
        canReplay={can("leads:replay")}
        replayPending={replay.isPending}
        onReplay={() => void handleReplay()}
      />

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="scores">Scores ({lead.scores.length})</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          <TabsTrigger value="routing">Routing ({lead.routingResults.length})</TabsTrigger>
          <TabsTrigger value="deliveries">Deliveries ({lead.deliveries.length})</TabsTrigger>
          <TabsTrigger value="raw">Raw payload ({lead.rawPayloads.length})</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <LeadOverview lead={lead} />
        </TabsContent>
        <TabsContent value="pipeline">
          <LeadPipeline events={lead.stageEvents} />
        </TabsContent>
        <TabsContent value="scores">
          <LeadScores scores={lead.scores} activeVersion={lead.scoreVersion} />
        </TabsContent>
        <TabsContent value="duplicates">
          <LeadDuplicates lead={lead} />
        </TabsContent>
        <TabsContent value="routing">
          <LeadRouting results={lead.routingResults} />
        </TabsContent>
        <TabsContent value="deliveries">
          <LeadDeliveries deliveries={lead.deliveries} />
        </TabsContent>
        <TabsContent value="raw">
          <LeadRawPayloads payloads={lead.rawPayloads} />
        </TabsContent>
        <TabsContent value="audit">
          <LeadAudit leadId={lead.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
