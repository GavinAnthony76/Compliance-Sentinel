import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function HookScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 4000), // Start exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-bg-dark text-text-inverse"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 z-0">
        <img 
          src={`${import.meta.env.BASE_URL}images/lawn-worker.png`} 
          alt="Landscaping crew at work" 
          className="w-full h-full object-cover opacity-30" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg-dark to-transparent" />
      </div>

      <div className="relative z-10 text-center px-8">
        <motion.div 
          className="mb-6 overflow-hidden"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="bg-primary/20 text-accent font-semibold tracking-wider uppercase text-[1.5vw] py-2 px-6 rounded-full inline-block backdrop-blur-sm border border-primary/30">
            GreenSynk
          </div>
        </motion.div>

        <motion.h1 
          className="font-display font-black text-[7vw] leading-[0.9] tracking-tight"
          initial={{ y: 50, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, opacity: 1 } : { y: 50, opacity: 0 }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        >
          Run your outdoor service business<br/>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-emerald-300">
            on autopilot.
          </span>
        </motion.h1>
      </div>
    </motion.div>
  );
}
