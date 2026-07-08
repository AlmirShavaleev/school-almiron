import './LandingPage.css'
import './LandingPageSections.css'
import { LandingHeader } from '../components/landing/LandingHeader'
import { LandingHero } from '../components/landing/LandingHero'
import { PlatformStory } from '../components/landing/PlatformStory'
import { FeaturesGrid } from '../components/landing/FeaturesGrid'
import { LearningFormats } from '../components/landing/LearningFormats'
import { ResultsSection } from '../components/landing/ResultsSection'
import { ParentsSection } from '../components/landing/PeopleSections'
import { TeacherSection } from '../components/landing/TeacherSection'
import { LandingFaq, LandingCta, LandingFooter } from '../components/landing/LandingClosing'

export function LandingPage() {
  return <main className="almiron" id="top"><LandingHeader/><LandingHero/><PlatformStory/><FeaturesGrid/><LearningFormats/><ResultsSection/><TeacherSection/><ParentsSection/><LandingFaq/><LandingCta/><LandingFooter/></main>
}
