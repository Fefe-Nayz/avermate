"use client";

import { useEffect, useState } from "react";

export function AprilFoolsThemeProvider() {
  const [isAprilFools, setIsAprilFools] = useState(false);
  
  useEffect(() => {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFirst = today.getMonth() === 3 && today.getDate() === 1;
    setIsAprilFools(isAprilFirst);
    
    if (isAprilFirst) {
      // Add the ugly April Fools CSS to the document
      const styleElement = document.createElement('style');
      styleElement.setAttribute('id', 'april-fools-style');
      styleElement.textContent = `
        :root {
          --background: 280 70% 90% !important;
          --foreground: 120 100% 50% !important;
          --card: 60 80% 70% !important;
          --card-foreground: 300 100% 30% !important;
          --popover: 350 80% 80% !important;
          --popover-foreground: 240 100% 50% !important;
          --primary: 30 100% 50% !important;
          --primary-foreground: 270 100% 40% !important;
          --secondary: 180 100% 70% !important;
          --secondary-foreground: 0 100% 50% !important;
          --muted: 120 70% 80% !important;
          --muted-foreground: 330 100% 40% !important;
          --accent: 10 90% 80% !important;
          --accent-foreground: 190 100% 30% !important;
          --destructive: 140 100% 40% !important;
          --destructive-foreground: 60 100% 50% !important;
          --border: 320 100% 60% !important;
          --input: 200 100% 80% !important;
          --ring: 30 100% 60% !important;
        }
        
        .dark {
          --background: 30 80% 30% !important;
          --foreground: 120 100% 70% !important;
          --card: 270 70% 20% !important;
          --card-foreground: 30 100% 70% !important;
          --popover: 330 70% 30% !important;
          --popover-foreground: 150 100% 60% !important;
          --primary: 0 100% 70% !important;
          --primary-foreground: 180 100% 30% !important;
          --secondary: 210 100% 30% !important;
          --secondary-foreground: 60 100% 70% !important;
          --muted: 150 50% 40% !important;
          --muted-foreground: 0 100% 80% !important;
          --accent: 330 80% 40% !important;
          --accent-foreground: 150 100% 70% !important;
          --destructive: 120 80% 30% !important;
          --destructive-foreground: 30 100% 80% !important;
          --border: 0 100% 60% !important;
          --input: 240 100% 40% !important;
          --ring: 60 100% 50% !important;
        }
        
        /* Add some comic sans for extra ugliness */
        * {
          font-family: "Comic Sans MS", cursive, sans-serif !important;
        }
        
        /* Make some buttons wiggle */
        button, a {
          animation: wiggle 2s infinite;
        }
        
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(5deg); }
          75% { transform: rotate(-5deg); }
        }
      `;
      
      document.head.appendChild(styleElement);
      
      // Cleanup function to remove the styles when component unmounts
      return () => {
        const styleToRemove = document.getElementById('april-fools-style');
        if (styleToRemove) {
          styleToRemove.remove();
        }
      };
    }
  }, []);
  
  return null;
}