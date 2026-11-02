import ProviderManager from "@/components/ProviderManager";
import { providerView } from "@/lib/provider-store";

export default function ProviderPage() {
  return (
    <div className="space-y-5">
      <header>
        <div className="kicker">Provider AI</div>
        <h1 className="mt-1 text-2xl font-bold">Provider ảnh cho render</h1>
        <p className="text-xs text-slate-500">
          Thêm endpoint sinh ảnh (CLIProxyAPI, OpenAI, gateway OpenAI/Gemini-compatible) mà không sửa code hay restart. Profile chọn provider ở mục “Ảnh AI cho cảnh”;
          render, nút ✨ tạo ảnh cảnh và ảnh ref nhân vật đều dùng provider đó. Lỗi thì theo <code>IMAGE_FALLBACK</code> nếu có đặt.
        </p>
      </header>
      <ProviderManager initial={providerView()} />
    </div>
  );
}
