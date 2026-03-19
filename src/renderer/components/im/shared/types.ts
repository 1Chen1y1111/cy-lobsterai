import type { ReactNode } from 'react';

export interface IMFieldBaseProps {
  label: ReactNode;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void | Promise<void>;
  onClear?: () => void;
  clearLabel?: string;
  hint?: ReactNode;
}

export interface IMTextFieldProps extends IMFieldBaseProps {}

export interface IMSecretInputProps extends IMFieldBaseProps {
  isVisible: boolean;
  onToggleVisibility: () => void;
  showLabel?: string;
  hideLabel?: string;
}

export interface IMConnectivityTestButtonProps {
  isLoading: boolean;
  hasResult: boolean;
  disabled?: boolean;
  onClick: () => void;
  testingLabel: string;
  retestLabel: string;
  testLabel: string;
}