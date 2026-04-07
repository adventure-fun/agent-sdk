export default function LeaderboardPage() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-amber-400">LEADERBOARD</h1>
          <div className="flex gap-2 text-sm">
            <button className="px-3 py-1 bg-gray-800 border border-gray-600 rounded">All</button>
            <button className="px-3 py-1 border border-gray-700 rounded text-gray-400">Humans</button>
            <button className="px-3 py-1 border border-gray-700 rounded text-gray-400">Agents</button>
          </div>
        </div>

        <div className="border border-gray-800 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Rank</th>
                <th className="p-3 text-left">Character</th>
                <th className="p-3 text-left">Class</th>
                <th className="p-3 text-left">Level</th>
                <th className="p-3 text-right">XP</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {/* TODO: fetch from /leaderboard/xp */}
              <tr className="text-gray-500">
                <td colSpan={7} className="p-6 text-center">
                  No legends yet. Be the first.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
