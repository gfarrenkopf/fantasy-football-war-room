"use client";

import { useEffect } from "react";
import { subscribeSyncIssues, type SyncIssue } from "@/lib/storage";
import { useToast } from "./Feedback";

const MESSAGES: Record<SyncIssue["kind"], string> = {
  offline: "Can't reach the server. Changes are saved on this device and will sync when you're back online.",
  "signed-out": "Your session expired. Changes are saved on this device; sign in again to sync them.",
  conflict: "This draft was also changed on another device. This device's picks replaced those changes.",
  gone: "A league was deleted on another device.",
};

/** Shows background sync problems from the server-backed stores as toasts. */
export function SyncNotices() {
  const toast = useToast();
  useEffect(() => subscribeSyncIssues((issue) => toast(MESSAGES[issue.kind])), [toast]);
  return null;
}
