export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKeeper } = await import("@/engine/keeper");
    startKeeper();
  }
}
