export default function AuroraBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none">
      <div className="aurora-orb aurora-orb-1 absolute w-[700px] h-[700px] rounded-full blur-[100px] opacity-[var(--aurora-opacity)] -top-[250px] -left-[150px] bg-[radial-gradient(circle,#6366f1,transparent)] animate-float" />
      <div className="aurora-orb aurora-orb-2 absolute w-[600px] h-[600px] rounded-full blur-[100px] opacity-[var(--aurora-opacity)] top-[15%] -right-[200px] bg-[radial-gradient(circle,#8b5cf6,transparent)]" />
      <div className="aurora-orb aurora-orb-3 absolute w-[550px] h-[550px] rounded-full blur-[90px] opacity-[var(--aurora-opacity)] bottom-[5%] left-[15%] bg-[radial-gradient(circle,#06b6d4,transparent)] animate-float" />
      <div className="aurora-orb aurora-orb-4 absolute w-[450px] h-[450px] rounded-full blur-[80px] opacity-[var(--aurora-opacity)] top-[50%] right-[25%] bg-[radial-gradient(circle,#a855f7,transparent)]" />
    </div>
  );
}
