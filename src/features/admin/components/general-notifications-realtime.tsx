"use client";

/**
 * Unified Realtime refresher for the administrator inbox.
 *
 * It subscribes to INSERT events on both durable sources: general notifications
 * and OQ-16 SLA notifications. INSERT rows carry the complete new record and are
 * the source of truth. `payload.old` is never read and UPDATE/DELETE delivery is
 * not required for correctness. Each INSERT also raises a Spanish in-app toast
 * through the existing provider; there is no browser/system push, e-mail or
 * WhatsApp delivery.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useToast } from "@/components/ui/toast";
import {
  createNotificationToastDeduplicator,
  notificationToastMessage,
  type NotificationToastSource,
} from "@/features/admin/notification-realtime-toast";
import {
  GENERAL_NOTIFICATIONS_CHANNEL,
  GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS,
  SLA_NOTIFICATIONS_CHANNEL,
  createGeneralNotificationsRefreshScheduler,
  generalNotificationsChangeConfig,
  slaNotificationsChangeConfig,
} from "@/features/admin/general-notifications-helpers";
import { createSupabaseBrowserClient } from "@/infrastructure/supabase/client";

type ChannelState = {
  channel: RealtimeChannel | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnected: boolean;
};

export function UnifiedNotificationsRealtime({ adminId }: { adminId: string }) {
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const scheduler = createGeneralNotificationsRefreshScheduler(() => router.refresh());
    const shouldToast = createNotificationToastDeduplicator();

    function handleInsert(source: NotificationToastSource, payload: { new: unknown }) {
      scheduler.schedule();
      if (!shouldToast(source, payload.new)) return;
      showToast(notificationToastMessage(source, payload.new), "info");
    }

    const subscriptions = [
      {
        name: `${GENERAL_NOTIFICATIONS_CHANNEL}:${adminId}`,
        config: generalNotificationsChangeConfig(adminId),
        source: "general" as const,
      },
      {
        name: `${SLA_NOTIFICATIONS_CHANNEL}:${adminId}`,
        config: slaNotificationsChangeConfig(adminId),
        source: "sla" as const,
      },
    ];
    const states: ChannelState[] = subscriptions.map(() => ({
      channel: null,
      reconnectTimer: null,
      reconnected: false,
    }));
    let disposed = false;

    function subscribe(index: number) {
      const state = states[index];
      const { name, config, source } = subscriptions[index];

      state.channel = supabase
        .channel(name)
        .on("postgres_changes", config, (payload) => {
          handleInsert(source, payload);
        })
        .subscribe((status) => {
          if (
            (status === "CHANNEL_ERROR" || status === "TIMED_OUT") &&
            !disposed &&
            !state.reconnected
          ) {
            // Exactly one recovery attempt per channel. Repeated failures stay
            // quiet and the next page load starts fresh. No periodic polling.
            state.reconnected = true;
            if (state.channel) void supabase.removeChannel(state.channel);
            state.channel = null;
            state.reconnectTimer = setTimeout(() => {
              state.reconnectTimer = null;
              if (!disposed) subscribe(index);
            }, GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS);
          }
        });
    }

    subscriptions.forEach((_, index) => subscribe(index));

    return () => {
      disposed = true;
      scheduler.cancel();
      for (const state of states) {
        if (state.reconnectTimer !== null) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        if (state.channel) void supabase.removeChannel(state.channel);
      }
    };
  }, [adminId, router, showToast]);

  return null;
}
