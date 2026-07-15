import React, { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring, useMotionTemplate } from 'framer-motion';

export const HeroBackground = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springX = useSpring(mouseX, { stiffness: 300, damping: 30 });
  const springY = useSpring(mouseY, { stiffness: 300, damping: 30 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Interactive Cursor Spotlight */}
      <motion.div
        className="absolute inset-0 z-20"
        style={{
          background: useMotionTemplate`radial-gradient(350px circle at ${springX}px ${springY}px, rgba(239,68,68,0.2), transparent 80%)`
        }}
      />
      
      {/* Animated Subtle Grid */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:30px_30px]"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)'
        }}
      >
        <motion.div 
          className="absolute inset-0"
          animate={{ backgroundPosition: ['0px 0px', '30px 30px'] }}
          transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
          style={{
            backgroundImage: 'linear-gradient(rgba(239,68,68,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(239,68,68,0.05) 1px, transparent 1px)',
            backgroundSize: '30px 30px'
          }}
        />
      </div>

      {/* Glowing Floating Orbs */}
      <motion.div 
        className="absolute -top-32 -left-32 w-96 h-96 bg-red-500/20 rounded-full blur-[100px]"
        animate={{
          scale: [1, 1.2, 1],
          x: [0, 50, 0],
          y: [0, 30, 0]
        }}
        transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
      />
      <motion.div 
        className="absolute -bottom-32 right-10 w-80 h-80 bg-orange-500/10 rounded-full blur-[80px]"
        animate={{
          scale: [1, 1.3, 1],
          x: [0, -40, 0],
          y: [0, -20, 0]
        }}
        transition={{ repeat: Infinity, duration: 10, ease: "easeInOut", delay: 2 }}
      />

      {/* Sweeping Scanner Line */}
      <motion.div 
        className="absolute top-0 bottom-0 w-1 bg-gradient-to-b from-transparent via-red-500/50 to-transparent shadow-[0_0_20px_rgba(239,68,68,0.8)]"
        animate={{ left: ['0%', '100%'] }}
        transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
      />
      
      {/* Edge Gradient Mask for seamless blending */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c14] via-transparent to-transparent"></div>
    </div>
  );
};
