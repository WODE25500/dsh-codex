// dsh 0.2 exposes execute(), while dsh 0.1 exposes run().
export async function runShell(shell, spec) {
  if (typeof shell.execute === 'function') return (await shell.execute(spec)).result()
  return shell.run(spec)
}
