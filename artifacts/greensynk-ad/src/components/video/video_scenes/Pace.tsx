import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function PaceScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 0),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2400),
      setTimeout(() => setPhase(4), 4000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const phrases = ["Track Jobs", "Get Paid", "Grow Fast"];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center bg-accent"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ clipPath: 'circle(0% at 50% 50%)', opacity: 0 }}
      transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
    >
      <div className="text-center relative">
        {phrases.map((phrase, i) => (
          <motion.h2
            key={phrase}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] font-display font-black text-[12vw] text-bg-dark leading-none uppercase tracking-tighter"
            initial={{ opacity: 0, scale: 0.5, rotate: -5 }}
            animate={
              phase === i + 1 
                ? { opacity: 1, scale: 1, rotate: 0 } 
                : { opacity: 0, scale: phase > i + 1 ? 1.5 : 0.5, rotate: phase > i + 1 ? 5 : -5 }
            }
            transition={{ duration: 0.4, type: "spring", bounce: 0.4 }}
            style={{ 
              pointerEvents: 'none',
            }}
          >
            {phrase}
          </motion.h2>
        ))}
      </div>
    </motion.div>
  );
}
