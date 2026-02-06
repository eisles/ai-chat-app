export default function MaintenancePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-5xl">🔧</div>
      <h1 className="text-2xl font-bold">メンテナンス中</h1>
      <p className="max-w-md text-muted-foreground">
        現在、システムメンテナンスを実施しています。
        <br />
        ご不便をおかけしますが、しばらくお待ちください。
      </p>
    </div>
  );
}
