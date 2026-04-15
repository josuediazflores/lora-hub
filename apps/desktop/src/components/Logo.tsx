type Props = { className?: string };

export function Logo({ className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 1.5l1.6 6.4 6.4 1.6-6.4 1.6L12 17.5l-1.6-6.4L4 9.5l6.4-1.6z" />
      <path d="M19 14l.7 2.8L22.5 17.5l-2.8.7L19 21l-.7-2.8L15.5 17.5l2.8-.7z" />
    </svg>
  );
}
