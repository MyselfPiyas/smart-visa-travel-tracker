import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button, Card, ErrorState, FormField, LoadingIndicator, StatusBadge } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function getErrorMessage(error) {
  const fields = error.response?.data?.error?.fields;
  return fields ? { ...fields, form: error.response?.data?.error?.message || 'Check your information and try again.' } : { form: error.response?.data?.error?.message || 'We could not reach the account service. Please try again.' };
}

export function AuthPage({ register = false }) {
  const { user, login, register: createAccount, loading: sessionLoading, sessionError } = useAuth();
  const navigate = useNavigate(); const location = useLocation();
  const [values, setValues] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({}); const [submitting, setSubmitting] = useState(false);
  const title = register ? 'Create your account' : 'Welcome back';

  useEffect(() => { if (!sessionLoading && user) navigate(user.role === 'admin' ? '/admin/dashboard' : '/app/dashboard', { replace: true }); }, [sessionLoading, user, navigate]);

  function update(event) { setValues((current) => ({ ...current, [event.target.name]: event.target.value })); setErrors((current) => ({ ...current, [event.target.name]: '', form: '' })); }
  function validate() {
    const next = {};
    if (register && !values.name.trim()) next.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) next.email = 'Enter a valid email address.';
    const passwordBytes = new TextEncoder().encode(values.password).length;
    if (register && (passwordBytes < 12 || passwordBytes > 72)) next.password = 'Use at least 12 characters (up to 72 UTF-8 bytes).';
    if (!register && !values.password) next.password = 'Enter your password.';
    else if (!register && passwordBytes > 72) next.password = 'Password must be no more than 72 UTF-8 bytes.';
    if (register && values.confirmPassword !== values.password) next.confirmPassword = 'Passwords do not match.';
    return next;
  }

  async function submit(event) {
    event.preventDefault(); const nextErrors = validate(); setErrors(nextErrors); if (Object.keys(nextErrors).length) return;
    setSubmitting(true);
    try {
      const website = event.currentTarget.elements.namedItem('website')?.value || '';
      const user = register ? await createAccount({ name: values.name.trim(), email: values.email.trim(), password: values.password, website }) : await login({ email: values.email.trim(), password: values.password, website });
      const requestedPath = location.state?.from?.pathname;
      const defaultPath = user.role === 'admin' ? '/admin/dashboard' : '/app/dashboard';
      navigate(requestedPath?.startsWith(user.role === 'admin' ? '/admin' : '/app') ? requestedPath : defaultPath, { replace: true });
    } catch (error) { setErrors(getErrorMessage(error)); }
    finally { setSubmitting(false); }
  }

  if (sessionLoading || user) return <div className="mx-auto max-w-xl px-5 py-16"><LoadingIndicator label="Checking your session…"/></div>;
  return <div className="mx-auto max-w-xl px-5 py-10 sm:py-16"><Card className="p-6 sm:p-9"><StatusBadge tone="success">Secure account access</StatusBadge><h1 className="mt-5 text-3xl font-bold tracking-tight">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{register ? 'Create a traveler account to continue to your workspace.' : 'Sign in to continue to your travel workspace.'}</p>{sessionError && <div className="mt-5"><ErrorState title="Account service unavailable" description={sessionError}/></div>}{errors.form && <div className="mt-5"><ErrorState title="Unable to continue" description={errors.form}/></div>}
    <form onSubmit={submit} noValidate className="mt-7 space-y-4"><div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true"><label htmlFor="website">Leave this field empty</label><input id="website" name="website" type="text" tabIndex={-1} autoComplete="off"/></div>{register && <FormField id="name" name="name" label="Full name" autoComplete="name" maxLength={120} value={values.name} onChange={update} error={errors.name} aria-invalid={Boolean(errors.name)}/>}<FormField id="email" name="email" label="Email address" type="email" autoComplete="email" maxLength={254} value={values.email} onChange={update} error={errors.email} aria-invalid={Boolean(errors.email)}/><FormField id="password" name="password" label="Password" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={values.password} onChange={update} error={errors.password} aria-invalid={Boolean(errors.password)} hint={register ? 'At least 12 characters. Passwords are stored as secure hashes.' : undefined}/>{register && <FormField id="confirmPassword" name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" value={values.confirmPassword} onChange={update} error={errors.confirmPassword} aria-invalid={Boolean(errors.confirmPassword)}/>}<Button type="submit" disabled={submitting} className="w-full">{submitting ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button></form>
    <p className="mt-6 text-center text-sm text-slate-600">{register ? 'Already have an account?' : 'New to the tracker?'} <Link className="font-semibold text-teal-800 hover:underline" to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create account'}</Link></p><p className="mt-4 text-center text-xs text-slate-500">Your role is assigned securely by the server. Public sign-up creates traveler accounts.</p></Card></div>;
}
