import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function DispatchScene() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 5000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%', opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-[40%] relative z-10">
        <motion.h2 
          className="font-display font-bold text-[4.5vw] text-text-inverse leading-[1.1] mb-6"
          initial={{ x: -50, opacity: 0 }}
          animate={phase >= 1 ? { x: 0, opacity: 1 } : { x: -50, opacity: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          Schedule &<br/>Dispatch Crews
        </motion.h2>
        <motion.p 
          className="text-[1.8vw] text-text-muted"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          Optimize routes and track your team in real-time.
        </motion.p>
      </div>

      <div className="w-[50%] h-[60vh] relative">
        {/* Mock UI Map/Schedule */}
        <motion.div 
          className="absolute right-0 top-[10%] w-[40vw] h-[50vh] bg-secondary/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-6 flex flex-col gap-4 overflow-hidden"
          initial={{ scale: 0.8, rotateY: 20, opacity: 0 }}
          animate={phase >= 1 ? { scale: 1, rotateY: -5, opacity: 1 } : { scale: 0.8, rotateY: 20, opacity: 0 }}
          transition={{ duration: 1, type: "spring", bounce: 0.2 }}
          style={{ perspective: 1000 }}
        >
          <div className="flex justify-between items-center border-b border-white/10 pb-4">
            <div className="w-1/3 h-4 bg-white/20 rounded-full" />
            <div className="w-1/4 h-4 bg-accent/40 rounded-full" />
          </div>
          
          <div className="flex-1 flex gap-4 mt-2">
            <div className="w-1/3 h-full bg-white/5 rounded-xl flex flex-col gap-3 p-3">
              {[0, 1, 2].map((i) => (
                <motion.div 
                  key={i}
                  className="h-16 bg-white/10 rounded-lg w-full flex items-center px-3 gap-3"
                  initial={{ x: -20, opacity: 0 }}
                  animate={phase >= 2 ? { x: 0, opacity: 1 } : { x: -20, opacity: 0 }}
                  transition={{ delay: i * 0.15 + (phase >= 2 ? 0 : 0) }}
                >
                  <div className="w-8 h-8 rounded-full bg-accent/50" />
                  <div className="flex-1 h-3 bg-white/20 rounded-full" />
                </motion.div>
              ))}
            </div>
            <div className="flex-1 bg-black/40 rounded-xl relative overflow-hidden">
               {/* Map mockup */}
               <div className="absolute inset-0 bg-primary/10" />
               <motion.div 
                 className="absolute top-[40%] left-[30%] w-6 h-6 bg-accent rounded-full border-4 border-bg-dark shadow-[0_0_15px_var(--color-accent)]"
                 initial={{ scale: 0 }}
                 animate={phase >= 3 ? { scale: 1 } : { scale: 0 }}
                 transition={{ type: "spring", bounce: 0.5 }}
               />
               <motion.div 
                 className="absolute top-[60%] left-[60%] w-6 h-6 bg-accent rounded-full border-4 border-bg-dark shadow-[0_0_15px_var(--color-accent)]"
                 initial={{ scale: 0 }}
                 animate={phase >= 3 ? { scale: 1 } : { scale: 0 }}
                 transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
               />
               {/* Route line */}
               <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
                 <motion.path 
                   d="M 30% 40% Q 50% 30% 60% 60%" 
                   fill="none" 
                   stroke="var(--color-accent)" 
                   strokeWidth="3"
                   strokeDasharray="4 4"
                   initial={{ pathLength: 0 }}
                   animate={phase >= 3 ? { pathLength: 1 } : { pathLength: 0 }}
                   transition={{ duration: 1.5, ease: "easeInOut" }}
                 />
               </svg>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
