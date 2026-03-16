import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { OnboardingProfile } from '../lib/api'
import {
  calculateOnboardingProgress,
  type OnboardingListField,
  type OnboardingTextField,
} from '../lib/onboarding'

type OnboardingPanelProps = {
  connectedCount: number
  onboarding: OnboardingProfile
  onboardingDirty: boolean
  pendingApprovals: { id: string }[]
  prospectStatus: 'idle' | 'completed'
  requiredConnections: { status: string }[]
  saving: boolean
  workspace: { name: string; onboarding_completed: boolean }
  onListChange: (field: OnboardingListField, value: string) => void
  onSave: () => Promise<void>
  onTabChange: (tab: 'overview' | 'integrations' | 'prospects' | 'pipeline') => void
  onTextChange: (field: OnboardingTextField, value: string) => void
}

type StepId = 'company' | 'messaging' | 'icp'

const STEPS: { id: StepId; label: string; title: string; subtitle: string }[] = [
  {
    id: 'company',
    label: 'Company',
    title: "What are you\nbuilding?",
    subtitle: 'Tell us about your product and what you sell.',
  },
  {
    id: 'messaging',
    label: 'Messaging',
    title: "How do you\nwin deals?",
    subtitle: 'Define your value proposition and voice.',
  },
  {
    id: 'icp',
    label: 'Target',
    title: "Who's your\nbest customer?",
    subtitle: 'Define who should receive your outreach.',
  },
]

export function OnboardingPanel({
  onboarding,
  onboardingDirty,
  saving,
  onListChange,
  onSave,
  onTabChange,
  onTextChange,
}: OnboardingPanelProps) {
  const [step, setStep] = useState(0)
  const [animDir, setAnimDir] = useState<'forward' | 'back'>('forward')
  const [isAnimating, setIsAnimating] = useState(false)
  const [visibleStep, setVisibleStep] = useState(0)
  const completion = calculateOnboardingProgress(onboarding)
  const isLast = step === STEPS.length - 1
  const canFinish = completion >= 60

  function goTo(next: number, dir: 'forward' | 'back') {
    if (isAnimating) return
    setAnimDir(dir)
    setIsAnimating(true)
    setTimeout(() => {
      setVisibleStep(next)
      setStep(next)
      setIsAnimating(false)
    }, 280)
  }

  function handleNext() {
    if (!isLast) {
      goTo(step + 1, 'forward')
    }
  }

  function handleBack() {
    if (step > 0) {
      goTo(step - 1, 'back')
    }
  }

  async function handleFinish() {
    await onSave()
    onTabChange('integrations')
  }

  return (
    <div className="onboarding-fullscreen">
      <style>{`
        .onboarding-fullscreen {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
          background: #0a0a0f;
          color: #f0f0f5;
          font-family: 'Inter', system-ui, sans-serif;
          overflow: hidden;
        }

        /* Top bar */
        .ob-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 40px;
          flex-shrink: 0;
        }

        .ob-logo {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ob-logo-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          background: linear-gradient(135deg, #7c6af7, #5b4fcf);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(124, 106, 247, 0.4);
        }

        .ob-logo-text {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #f0f0f5;
        }

        /* Steps indicator */
        .ob-steps {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ob-step-item {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .ob-step-dot {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.3s ease;
          flex-shrink: 0;
        }

        .ob-step-dot.active {
          background: linear-gradient(135deg, #7c6af7, #5b4fcf);
          color: white;
          box-shadow: 0 0 16px rgba(124, 106, 247, 0.5);
        }

        .ob-step-dot.done {
          background: rgba(124, 106, 247, 0.2);
          color: #7c6af7;
          border: 1px solid rgba(124, 106, 247, 0.4);
        }

        .ob-step-dot.upcoming {
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .ob-step-label {
          font-size: 12px;
          font-weight: 500;
          transition: color 0.3s ease;
        }

        .ob-step-label.active { color: #f0f0f5; }
        .ob-step-label.done { color: rgba(124, 106, 247, 0.8); }
        .ob-step-label.upcoming { color: rgba(255, 255, 255, 0.25); }

        .ob-step-connector {
          width: 24px;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          flex-shrink: 0;
        }

        /* Main content */
        .ob-main {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 40px 40px;
          overflow: hidden;
          position: relative;
        }

        .ob-content {
          width: 100%;
          max-width: 560px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* Animation states */
        .ob-slide {
          transition: opacity 0.28s ease, transform 0.28s ease;
        }

        .ob-slide.entering-forward {
          opacity: 0;
          transform: translateX(32px);
        }

        .ob-slide.entering-back {
          opacity: 0;
          transform: translateX(-32px);
        }

        .ob-slide.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .ob-slide.exiting-forward {
          opacity: 0;
          transform: translateX(-32px);
        }

        .ob-slide.exiting-back {
          opacity: 0;
          transform: translateX(32px);
        }

        /* Title */
        .ob-title {
          font-size: clamp(32px, 5vw, 52px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
          white-space: pre-line;
          margin-bottom: 12px;
          background: linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.7) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .ob-subtitle {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.45);
          margin-bottom: 44px;
          line-height: 1.6;
        }

        /* Fields */
        .ob-fields {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .ob-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .ob-field-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.35);
        }

        .ob-field-hint {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.25);
          margin-top: -4px;
        }

        .ob-input, .ob-textarea {
          width: 100%;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 14px 16px;
          font-size: 15px;
          color: rgba(255, 255, 255, 0.9);
          outline: none;
          transition: all 0.2s ease;
          font-family: inherit;
          box-sizing: border-box;
        }

        .ob-input::placeholder, .ob-textarea::placeholder {
          color: rgba(255, 255, 255, 0.18);
        }

        .ob-input:focus, .ob-textarea:focus {
          border-color: rgba(124, 106, 247, 0.5);
          background: rgba(124, 106, 247, 0.06);
          box-shadow: 0 0 0 3px rgba(124, 106, 247, 0.1);
        }

        .ob-textarea {
          resize: none;
          line-height: 1.6;
          height: 96px;
        }

        .ob-field-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        /* Bottom nav */
        .ob-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 40px;
        }

        .ob-btn-ghost {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          color: rgba(255, 255, 255, 0.4);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
        }

        .ob-btn-ghost:hover:not(:disabled) {
          border-color: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.04);
        }

        .ob-btn-ghost:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .ob-btn-primary {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: linear-gradient(135deg, #7c6af7, #5b4fcf);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
          box-shadow: 0 4px 20px rgba(124, 106, 247, 0.35);
        }

        .ob-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 28px rgba(124, 106, 247, 0.5);
        }

        .ob-btn-primary:active:not(:disabled) {
          transform: translateY(0);
        }

        .ob-btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .ob-btn-finish {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          box-shadow: 0 4px 20px rgba(34, 197, 94, 0.3);
        }

        .ob-btn-finish:hover:not(:disabled) {
          box-shadow: 0 6px 28px rgba(34, 197, 94, 0.45);
        }

        .ob-btn-finish.blocked {
          background: linear-gradient(135deg, #7c6af7, #5b4fcf);
          box-shadow: 0 4px 20px rgba(124, 106, 247, 0.35);
        }

        /* Progress bar at top */
        .ob-progress-bar {
          position: absolute;
          top: 0;
          left: 0;
          height: 2px;
          background: linear-gradient(90deg, #7c6af7, #5b4fcf);
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Save indicator */
        .ob-save-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.35);
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        /* Background ambience */
        .ob-bg-glow {
          position: fixed;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
          opacity: 0.12;
          z-index: 0;
        }

        .ob-bg-glow-1 {
          top: -200px;
          right: -100px;
          background: #7c6af7;
        }

        .ob-bg-glow-2 {
          bottom: -200px;
          left: -200px;
          background: #5b4fcf;
          opacity: 0.08;
        }

        .ob-content-wrapper {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
      `}</style>

      {/* Background glow */}
      <div className="ob-bg-glow ob-bg-glow-1" />
      <div className="ob-bg-glow ob-bg-glow-2" />

      {/* Progress bar */}
      <div className="ob-progress-bar" style={{ width: `${completion}%` }} />

      <div className="ob-content-wrapper">
        {/* Top bar */}
        <div className="ob-topbar">
          <div className="ob-logo">
            <div className="ob-logo-icon">
              <Sparkles style={{ width: 14, height: 14, color: 'white' }} />
            </div>
            <span className="ob-logo-text">PipeIQ</span>
          </div>

          <div className="ob-steps">
            {STEPS.map((s, i) => {
              const state = i === step ? 'active' : i < step ? 'done' : 'upcoming'
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 && <div className="ob-step-connector" />}
                  <div className="ob-step-item" onClick={() => i < step && goTo(i, 'back')}>
                    <div className={`ob-step-dot ${state}`}>
                      {state === 'done' ? <Check style={{ width: 12, height: 12 }} /> : i + 1}
                    </div>
                    <span className={`ob-step-label ${state}`}>{s.label}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="ob-save-pill">
            {saving ? (
              <>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c6af7', display: 'inline-block' }} />
                Saving…
              </>
            ) : onboardingDirty ? (
              <>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                Unsaved
              </>
            ) : (
              <>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                {completion}% complete
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="ob-main">
          <div className="ob-content">
            <StepSlide
              isAnimating={isAnimating}
              animDir={animDir}
              currentStep={step}
              visibleStep={visibleStep}
            >
              <h1 className="ob-title">{STEPS[visibleStep].title}</h1>
              <p className="ob-subtitle">{STEPS[visibleStep].subtitle}</p>

              <div className="ob-fields">
                {visibleStep === 0 && (
                  <>
                    <ObField label="Product name" hint="What are you selling?">
                      <input
                        className="ob-input"
                        placeholder="Acme Inc."
                        value={onboarding.product_name}
                        onChange={(e) => onTextChange('product_name', e.target.value)}
                      />
                    </ObField>
                    <ObField label="Product description" hint="One compact explanation of the offer">
                      <textarea
                        className="ob-textarea"
                        placeholder="AI-powered outbound platform that finds leads, writes full emails, handles replies, and books meetings."
                        value={onboarding.product_description}
                        onChange={(e) => onTextChange('product_description', e.target.value)}
                      />
                    </ObField>
                    <ObField label="Call to action" hint="The goal of your outreach">
                      <input
                        className="ob-input"
                        placeholder="Book a 20-minute growth session"
                        value={onboarding.call_to_action}
                        onChange={(e) => onTextChange('call_to_action', e.target.value)}
                      />
                    </ObField>
                  </>
                )}

                {visibleStep === 1 && (
                  <>
                    <ObField label="Value proposition" hint="How you win versus the status quo">
                      <textarea
                        className="ob-textarea"
                        placeholder="We replace founder-led outbound with fully pre-rendered campaigns."
                        value={onboarding.value_proposition}
                        onChange={(e) => onTextChange('value_proposition', e.target.value)}
                      />
                    </ObField>
                    <ObField label="Pain points" hint="What urgency appears in email one">
                      <textarea
                        className="ob-textarea"
                        placeholder="Outbound depends on the founder, reply handling is manual."
                        value={onboarding.pain_points}
                        onChange={(e) => onTextChange('pain_points', e.target.value)}
                      />
                    </ObField>
                    <ObField label="Voice guidelines" hint="How the writing should sound">
                      <input
                        className="ob-input"
                        placeholder="Direct, specific, founder-level, and never robotic."
                        value={onboarding.voice_guidelines}
                        onChange={(e) => onTextChange('voice_guidelines', e.target.value)}
                      />
                    </ObField>
                  </>
                )}

                {visibleStep === 2 && (
                  <>
                    <ObField label="Target customer" hint="Your highest-conviction ICP right now">
                      <textarea
                        className="ob-textarea"
                        placeholder="B2B SaaS founders or first sales hires at pre-seed to Series A companies."
                        value={onboarding.target_customer}
                        onChange={(e) => onTextChange('target_customer', e.target.value)}
                      />
                    </ObField>
                    <div className="ob-field-grid">
                      <ObField label="Industries" hint="Comma-separated">
                        <input
                          className="ob-input"
                          placeholder="B2B SaaS, devtools"
                          value={listToCsv(onboarding.industries)}
                          onChange={(e) => onListChange('industries', e.target.value)}
                        />
                      </ObField>
                      <ObField label="Job titles" hint="Comma-separated">
                        <input
                          className="ob-input"
                          placeholder="Founder, CEO, VP Sales"
                          value={listToCsv(onboarding.titles)}
                          onChange={(e) => onListChange('titles', e.target.value)}
                        />
                      </ObField>
                      <ObField label="Company sizes" hint="Comma-separated">
                        <input
                          className="ob-input"
                          placeholder="2-30, 31-100"
                          value={listToCsv(onboarding.company_sizes)}
                          onChange={(e) => onListChange('company_sizes', e.target.value)}
                        />
                      </ObField>
                      <ObField label="Geographies" hint="Comma-separated">
                        <input
                          className="ob-input"
                          placeholder="United States, Canada"
                          value={listToCsv(onboarding.geos)}
                          onChange={(e) => onListChange('geos', e.target.value)}
                        />
                      </ObField>
                    </div>
                    <ObField label="Exclusions" hint="Who should never be contacted">
                      <input
                        className="ob-input"
                        placeholder="Agencies, enterprise-only teams"
                        value={listToCsv(onboarding.exclusions)}
                        onChange={(e) => onListChange('exclusions', e.target.value)}
                      />
                    </ObField>
                  </>
                )}
              </div>

              {/* Navigation */}
              <div className="ob-nav">
                <button
                  type="button"
                  className="ob-btn-ghost"
                  disabled={step === 0}
                  onClick={handleBack}
                >
                  <ArrowLeft style={{ width: 14, height: 14 }} />
                  Back
                </button>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {onboardingDirty && !saving && (
                    <button
                      type="button"
                      className="ob-btn-ghost"
                      onClick={() => void onSave()}
                    >
                      Save draft
                    </button>
                  )}

                  {isLast ? (
                    <button
                      type="button"
                      className={`ob-btn-primary ob-btn-finish${canFinish ? '' : ' blocked'}`}
                      disabled={saving}
                      onClick={() => void handleFinish()}
                    >
                      {saving ? (
                        'Saving…'
                      ) : canFinish ? (
                        <>
                          <Check style={{ width: 14, height: 14 }} />
                          Done — connect tools
                        </>
                      ) : (
                        <>Fill {60 - completion}% more to continue</>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ob-btn-primary"
                      onClick={handleNext}
                    >
                      Continue
                      <ArrowRight style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
              </div>
            </StepSlide>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepSlide({
  isAnimating,
  animDir,
  currentStep,
  visibleStep,
  children,
}: {
  isAnimating: boolean
  animDir: 'forward' | 'back'
  currentStep: number
  visibleStep: number
  children: ReactNode
}) {
  const isExiting = isAnimating && currentStep !== visibleStep
  const isEntering = isAnimating && currentStep === visibleStep

  let className = 'ob-slide visible'
  if (isExiting) {
    className = `ob-slide ${animDir === 'forward' ? 'exiting-forward' : 'exiting-back'}`
  } else if (isEntering) {
    className = `ob-slide ${animDir === 'forward' ? 'entering-forward' : 'entering-back'}`
  }

  return <div className={className}>{children}</div>
}

function ObField({
  children,
  hint,
  label,
}: {
  children: ReactNode
  hint: string
  label: string
}) {
  return (
    <div className="ob-field">
      <div>
        <p className="ob-field-label">{label}</p>
        <p className="ob-field-hint">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function listToCsv(values: string[]) {
  return values.join(', ')
}
