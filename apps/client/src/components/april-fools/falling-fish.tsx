"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Fish {
  id: number;
  x: number;
  size: number;
  delay: number;
  duration: number;
  rotation: number;
}

export function FallingFish() {
  const [fish, setFish] = useState<Fish[]>([]);
  const [isAprilFools, setIsAprilFools] = useState(false);
  
  useEffect(() => {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFirst = today.getMonth() === 3 && today.getDate() === 1;
    setIsAprilFools(isAprilFirst);
    
    if (isAprilFirst) {
      // Create 15 fish with random properties
      const newFish = Array.from({ length: 15 }, (_, i) => ({
        id: i,
        x: Math.random() * 100, // Random horizontal position (%)
        size: Math.random() * 30 + 20, // Random size between 20-50px
        delay: Math.random() * 5, // Random delay up to 5s
        duration: Math.random() * 10 + 8, // Random duration between 8-18s
        rotation: (Math.random() - 0.5) * 40 // Random rotation -20 to +20 degrees
      }));
      
      setFish(newFish);
    }
  }, []);
  
  if (!isAprilFools) return null;
  
  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-50 overflow-hidden">
      {fish.map((f) => (
        <motion.div
          key={f.id}
          className="absolute"
          style={{ left: `${f.x}%` }}
          initial={{ y: -100, rotate: f.rotation }}
          animate={{ 
            y: "100vh",
            rotate: [f.rotation, f.rotation * -1, f.rotation]
          }}
          transition={{
            y: { 
              duration: f.duration,
              delay: f.delay,
              repeat: Infinity,
              ease: "linear"
            },
            rotate: {
              duration: f.duration / 3,
              repeat: Infinity,
              repeatType: "reverse"
            }
          }}
        >
          <div style={{ width: f.size, height: f.size }}>
            {/* Fish emoji with random size */}
            <span style={{ fontSize: `${f.size}px` }}>🐟</span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}