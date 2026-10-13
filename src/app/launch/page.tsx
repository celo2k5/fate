import { LaunchFlow } from "./LaunchFlow";
import { PROTOCOL, type DestinyType } from "@/engine/config";

export const dynamic = "force-dynamic";

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ destiny?: string }> }) {
  const sp = await searchParams;
  const d = sp.destiny?.toUpperCase();
  const initial = (["PHOENIX", "GRAVITY", "ECHO", "ORBIT"].includes(d ?? "") ? d : null) as DestinyType | null;
  const B = PROTOCOL.bounds;
  const bounds = {
    executionThreshold: { min: Number(B.executionThreshold.min) / 1e9, max: Number(B.executionThreshold.max) / 1e9 },
    graduationThreshold: { min: Number(B.graduationThreshold.min) / 1e9, max: Number(B.graduationThreshold.max) / 1e9 },
  };
  return <LaunchFlow initialDestiny={initial} bounds={bounds} />;
}
