import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import type { OnboardingProfile } from '../lib/api'

type Step = {
  id: keyof OnboardingProfile
  question: string
  hint: string
  placeholder: string
  type: 'text' | 'textarea' | 'list'
  emoji: string
}

const STEPS: Step[] = [
  {
    id: 'product_name',
    question: "What's your product called?",
    hint: "This is how we'll refer to it in all outreach.",
    placeholder: "e.g. Acme CRM",
    type: 'text',
    emoji: '🏷️',
  },
  {
    id: 'product_description',
    question: "In one sentence, what does it do?",
    hint: "Think elevator pitch — what's the core value?",
    placeholder: "e.g. A CRM that auto-logs calls and emails so reps never miss a follow-up",
    type: 'textarea',
    emoji: '💡',
  },
  {
    id: 'value_proposition',
    question: "Why do customers choose you over alternatives?",
    hint: "Your strongest differentiator.",
    placeholder: "e.g. 10× faster setup than Salesforce, half the price of HubSpot",
    type: 'textarea',
    emoji: '🎯',
  },
  {
    id: 'pain_points',
    question: "What pain does your product solve?",
    hint: "The specific frustrations your best customers had before finding you.",
    placeholder: "e.g. Sales reps spending 3+ hours/day on manual data entry",
    type: 'textarea',
    emoji: '🩹',
  },
  {
    id: 'target_customer',
    question: "Who's your ideal customer?",
    hint: "Describe the person you want to sell to.",
    placeholder: "e.g. VP of Sales at B2B SaaS companies with 50–500 employees",
    type: 'textarea',
    emoji: '🎯',
  },
  {
    id: 'industries',
    question: "Which industries are you targeting?",
    hint: "Comma-separated list — we'll use this to filter prospects.",
    placeholder: "e.g. SaaS, FinTech, Healthcare IT",
    type: 'list',
    emoji: '🏢',
  },
  {
    id: 'titles',
    question: "What job titles should we reach out to?",
    hint: "The decision-makers or champions for your product.",
    placeholder: "e.g. VP Sales, Head of Revenue, Chief Revenue Officer",
    type: 'list',
    emoji: '👤',
  },
  {
    id: 'call_to_action',
    question: "What's the one ask in every email?",
    hint: "Keep it low-friction — what should the prospect do next?",
    placeholder: "e.g. Book a 15-minute demo",
    type: 'text',
    emoji: '📅',
  },
]

type Props = {
  initial: OnboardingProfile
  onComplete: (profile: OnboardingProfile) => void
  onSkip: () => void
}

export function AnimatedOnboarding({ initial, onComplete, onSkip }: Props) {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Partial<Record<keyof OnboardingProfile, string>>>({})
  const [inputValue, setInputValue] = useState('')
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [visible, setVisible] = useState(true)
  const [completed, setCompleted] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  const step = STEPS[currentStep]
  const progress = ((currentStep) / STEPS.length) * 100
  const isLast = currentStep === STEPS.length - 1

  // Pre-fill from initial profile
  useEffect(() => {
    const existingValue = initial[step.id]
    const strValue = Array.isArray(existingValue)
      ? existingValue.join(', ')
      : typeof existingValue === 'string' ? existingValue : ''
    setInputValue(strValue)
  }, [currentStep, initial, step.id])

  // Focus input on step change
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 380)
  }, [currentStep])

  function saveCurrentAnswer() {
    setAnswers((prev) => ({ ...prev, [step.id]: inputValue }))
  }

  function goNext() {
    if (!inputValue.trim() && !isLast) {
      // Allow skipping optional steps
    }
    saveCurrentAnswer()

    if (isLast) {
      // Build final profile
      const allAnswers = { ...answers, [step.id]: inputValue }
      const profile: OnboardingProfile = { ...initial }

      for (const s of STEPS) {
        const val = allAnswers[s.id] ?? ''
        if (s.type === 'list') {
          ;(profile as Record<string, unknown>)[s.id as string] = val
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        } else {
          ;(profile as Record<string, unknown>)[s.id as string] = val
        }
      }

      setCompleted(true)
      setTimeout(() => onComplete(profile), 1200)
      return
    }

    setDirection('forward')
    setVisible(false)
    setTimeout(() => {
      setCurrentStep((s) => s + 1)
      setVisible(true)
    }, 260)
  }

  function goBack() {
    if (currentStep === 0) return
    saveCurrentAnswer()
    setDirection('back')
    setVisible(false)
    setTimeout(() => {
      setCurrentStep((s) => s - 1)
      setVisible(true)
    }, 260)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (step.type === 'text' || (step.type !== 'textarea' && !e.shiftKey))) {
      e.preventDefault()
      goNext()
    }
    if (e.key === 'Enter' && step.type === 'textarea' && !e.shiftKey) {
      e.preventDefault()
      goNext()
    }
  }

  // ── Completion screen ──
  if (completed) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: 'hsl(var(--sidebar-bg))' }}>
        <div className="flex flex-col items-center gap-4 animate-fade-slide-up">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20" style={{ animation: 'pulseRing 1.5s ease-out 2' }}>
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-white">All set! Building your pipeline…</h2>
          <div className="flex gap-1.5 mt-2">
            <div className="typing-dot" style={{ background: 'hsl(var(--primary))' }} />
            <div className="typing-dot" style={{ background: 'hsl(var(--primary))', animationDelay: '0.15s' }} />
            <div className="typing-dot" style={{ background: 'hsl(var(--primary))', animationDelay: '0.3s' }} />
          </div>
        </div>
      </div>
    )
  }

  // ── Main onboarding ──
  return (
    <div
      className="flex h-screen flex-col items-center justify-center px-6"
      style={{ background: 'hsl(var(--sidebar-bg))' }}
    >
      {/* Logo */}
      <div className="absolute top-6 left-6 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <span className="text-[13px] font-semibold text-white">PipeIQ</span>
      </div>

      {/* Skip */}
      <button
        type="button"
        onClick={onSkip}
        className="absolute top-6 right-6 text-[12px] font-medium transition-colors"
        style={{ color: 'hsl(var(--sidebar-muted))' }}
      >
        Skip setup →
      </button>

      {/* Progress */}
      <div className="absolute top-0 left-0 right-0 h-[3px]">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Step counter */}
      <div className="mb-10 text-[12px] font-medium" style={{ color: 'hsl(var(--sidebar-muted))' }}>
        {currentStep + 1} / {STEPS.length}
      </div>

      {/* Question card */}
      <div
        className="w-full max-w-lg"
        style={{
          animation: visible
            ? direction === 'forward'
              ? 'fadeSlideUp 350ms cubic-bezier(0.22, 1, 0.36, 1) both'
              : 'fadeSlideUp 350ms cubic-bezier(0.22, 1, 0.36, 1) both'
            : 'fadeSlideDown 240ms ease both',
        }}
      >
        {/* Emoji + question */}
        <div className="mb-8">
          <span className="text-3xl mb-4 block">{step.emoji}</span>
          <h1 className="text-[26px] font-bold leading-tight text-white mb-3">
            {step.question}
          </h1>
          <p className="text-[14px] leading-relaxed" style={{ color: 'hsl(var(--sidebar-muted))' }}>
            {step.hint}
          </p>
        </div>

        {/* Input */}
        <div className="relative">
          {step.type === 'textarea' || step.type === 'list' ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              rows={3}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={step.placeholder}
              className="w-full rounded-xl px-5 py-4 text-[15px] font-medium text-white outline-none resize-none transition-all"
              style={{
                background: 'hsl(var(--sidebar-active-bg))',
                border: '1.5px solid hsl(var(--sidebar-border))',
                caretColor: 'hsl(var(--primary))',
                lineHeight: '1.6',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--primary))' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--sidebar-border))' }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={step.placeholder}
              className="w-full rounded-xl px-5 py-4 text-[15px] font-medium text-white outline-none transition-all"
              style={{
                background: 'hsl(var(--sidebar-active-bg))',
                border: '1.5px solid hsl(var(--sidebar-border))',
                caretColor: 'hsl(var(--primary))',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--primary))' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--sidebar-border))' }}
            />
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={currentStep === 0}
            className="text-[13px] font-medium transition-colors disabled:opacity-30"
            style={{ color: 'hsl(var(--sidebar-muted))' }}
          >
            ← Back
          </button>

          <div className="flex items-center gap-3">
            {!inputValue.trim() && !isLast && (
              <button
                type="button"
                onClick={goNext}
                className="text-[13px] font-medium transition-colors"
                style={{ color: 'hsl(var(--sidebar-muted))' }}
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {isLast ? (
                <>
                  <Check className="h-4 w-4" />
                  Let's go
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="mt-5 text-center text-[11px]" style={{ color: 'hsl(var(--sidebar-muted))' }}>
          Press <kbd className="rounded px-1.5 py-0.5 text-[10px] font-mono" style={{ background: 'hsl(var(--sidebar-active-bg))', color: 'hsl(var(--sidebar-fg))' }}>Enter</kbd> to continue
        </p>
      </div>

      {/* Step dots */}
      <div className="absolute bottom-8 flex gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === currentStep ? 20 : 6,
              height: 6,
              background: i === currentStep
                ? 'hsl(var(--primary))'
                : i < currentStep
                  ? 'hsl(var(--primary) / 0.4)'
                  : 'hsl(var(--sidebar-border))',
            }}
          />
        ))}
      </div>
    </div>
  )
}
