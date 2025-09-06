import React from 'react'

export default function FormContentWrapper({children}: {children: React.ReactNode}) {
  return (
    <div className='flex flex-col lg:gap-8 gap-4'>
      {children}
    </div>
  )
}
