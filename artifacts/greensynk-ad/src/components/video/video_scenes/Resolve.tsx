import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function ResolveScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 2500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-bg-dark"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      <motion.div 
        className="flex items-center gap-4 mb-8"
        initial={{ y: 30, opacity: 0 }}
        animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 30, opacity: 0 }}
        transition={{ type: "spring", damping: 20 }}
      >
        <div className="w-[6vw] h-[6vw] bg-accent rounded-xl flex items-center justify-center rotate-45 shadow-[0_0_40px_var(--color-accent)]">
          <div className="w-1/2 h-1/2 bg-bg-dark rounded-sm -rotate-45" />
        </div>
        <h1 className="font-display font-black text-[6vw] text-text-inverse tracking-tight">GreenSynk</h1>
      </motion.div>

      <motion.h2 
        className="text-[2.5vw] text-text-muted font-medium mb-12"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1 }}
      >
        The operating system for lawn care.
      </motion.h2>

      <motion.div
        className="px-10 py-5 bg-white text-bg-dark font-bold text-[1.8vw] rounded-full shadow-[0_0_30px_rgba(255,255,255,0.3)]"
        initial={{ scale: 0, opacity: 0 }}
        animate={phase >= 3 ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={{ type: "spring", bounce: 0.5 }}
      >
        Start your free trial
      </motion.div>
    </motion.div>
  );
}
