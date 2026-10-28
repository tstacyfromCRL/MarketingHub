import logo from '../assets/mantis-logo.png';
import icon from '../assets/mantis-icon.png';

/** The wordmark stands in for the product name. The icon is the small mark for the top bar, window, and notifications. */
export function BrandMark({ variant = 'logo', className = '' }: { variant?: 'logo' | 'icon'; className?: string }) {
  return <img src={variant === 'icon' ? icon : logo} alt="Mantis" draggable={false} className={`select-none object-contain ${className}`} />;
}
