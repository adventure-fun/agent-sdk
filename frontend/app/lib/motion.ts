"use client"

import type { Transition, Variants } from "framer-motion"

export const softSpring: Transition = {
  type: "spring",
  stiffness: 180,
  damping: 22,
  mass: 0.85,
}

export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: "easeOut",
      when: "beforeChildren",
      staggerChildren: 0.08,
    },
  },
}

export const sectionReveal: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: softSpring,
  },
}

export const listStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.04,
    },
  },
}

export const listItemReveal: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: softSpring,
  },
}
