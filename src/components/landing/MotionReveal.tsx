import {motion,useReducedMotion} from 'framer-motion'
import type {ReactNode} from 'react'
export function MotionReveal({children,className='',delay=0,direction='up'}:{children:ReactNode;className?:string;delay?:number;direction?:'up'|'left'|'right'}){const reduce=useReducedMotion();const axis=direction==='left'?{x:-32}:direction==='right'?{x:32}:{y:32};return <motion.div className={className} initial={reduce?false:{opacity:0,...axis}} whileInView={{opacity:1,x:0,y:0}} viewport={{once:true,amount:.18}} transition={{duration:.7,delay,ease:[.22,1,.36,1]}}>{children}</motion.div>}
