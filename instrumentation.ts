export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NAS_MODE === 'local') {
    const { startSync } = await import('./lib/sync');
    await startSync();
  }
}
