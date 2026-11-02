export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; next?: string }> }) {
  const { err, next } = await searchParams;
  const missing = !process.env.ADMIN_PASSWORD;
  return (
    <div className="min-h-screen grid place-items-center bg-canvas">
      <form action="/api/login" method="post" className="w-80 rounded-2xl bg-white p-6 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-slate-900 text-white grid place-items-center text-sm">▶</div>
          <div><div className="font-semibold">Xưởng video</div><div className="text-xs text-slate-500">Sản xuất &amp; lịch đăng</div></div>
        </div>
        {missing && <p className="text-xs text-red-600">Chưa đặt ADMIN_PASSWORD trong .env nên chưa đăng nhập được.</p>}
        {err && <p className="text-xs text-red-600">Sai mật khẩu.</p>}
        {next && <input type="hidden" name="next" value={next} />}
        <input name="password" type="password" placeholder="Mật khẩu admin" autoFocus className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700">Đăng nhập</button>
      </form>
    </div>
  );
}
