import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function InvoiceScene() {
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
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-[45%] h-[60vh] relative z-10">
        <motion.div 
          className="absolute left-0 top-[10%] w-[35vw] h-[45vh] bg-white rounded-2xl shadow-2xl p-8 flex flex-col justify-between"
          initial={{ y: 50, rotateZ: -5, opacity: 0 }}
          animate={phase >= 1 ? { y: 0, rotateZ: -2, opacity: 1 } : { y: 50, rotateZ: -5, opacity: 0 }}
          transition={{ duration: 0.8, type: "spring", bounce: 0.2 }}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="text-gray-400 font-bold tracking-widest text-sm uppercase">Invoice #1042</div>
              <div className="text-gray-800 font-display font-bold text-3xl mt-2">$450.00</div>
            </div>
            <motion.div 
              className="px-4 py-1 bg-green-100 text-green-700 font-bold rounded-full text-sm"
              initial={{ scale: 0 }}
              animate={phase >= 3 ? { scale: 1 } : { scale: 0 }}
              transition={{ type: "spring", bounce: 0.6 }}
            >
              PAID
            </motion.div>
          </div>
          
          <div className="flex-1 mt-8 flex flex-col gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="flex justify-between items-center border-b border-gray-100 pb-4">
                <div className="flex flex-col gap-2 w-1/2">
                  <div className="h-3 bg-gray-200 rounded w-full" />
                  <div className="h-2 bg-gray-100 rounded w-2/3" />
                </div>
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="w-[45%] relative z-10 text-right">
        <motion.h2 
          className="font-display font-bold text-[4.5vw] text-text-inverse leading-[1.1] mb-6"
          initial={{ x: 50, opacity: 0 }}
          animate={phase >= 1 ? { x: 0, opacity: 1 } : { x: 50, opacity: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          Automate<br/>Invoicing
        </motion.h2>
        <motion.p 
          className="text-[1.8vw] text-text-muted"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        >
          Send invoices instantly and get paid faster.
        </motion.p>
      </div>
    </motion.div>
  );
}
