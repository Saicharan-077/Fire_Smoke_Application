import React from 'react';
import { motion } from 'framer-motion';

interface AnimatedContainerProps extends React.ComponentProps<typeof motion.div> {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export const AnimatedContainer: React.FC<AnimatedContainerProps> = ({
  children,
  delay = 0,
  className = '',
  ...props
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, delay, ease: [0.23, 1, 0.32, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedContainer;
