import React from 'react';
import { screen } from '@testing-library/react';
import Dashboard from '../../jsx/pages/index';
import { renderWithProviders } from '../../testUtils';

describe('Dashboard Page (landing)', () => {
  it('renders the organizer-first hero headline', () => {
    renderWithProviders(<Dashboard />);
    expect(
      screen.getByText(/^credentials you can prove, privately$/i),
    ).toBeInTheDocument();
  });

  it('renders the three "How it works" steps', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument();
    ['Create', 'Invite', 'Verify'].forEach((step) => {
      expect(screen.getByRole('heading', { name: new RegExp(`${step}$`) })).toBeInTheDocument();
    });
  });

  it('renders the four use cases', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Event attendance')).toBeInTheDocument();
    expect(screen.getByText('Diplomas & certificates')).toBeInTheDocument();
    expect(screen.getByText('Memberships & communities')).toBeInTheDocument();
    expect(screen.getByText('Access & age checks')).toBeInTheDocument();
  });

  it('leads with one organizer button and a smaller link for people who received a credential', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.queryByRole('button', { name: /^roles/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start issuing/i })).toHaveAttribute('href', '/organizer');
    expect(screen.getByRole('link', { name: /received a credential\? see yours/i })).toHaveAttribute(
      'href',
      '/subscriber',
    );
  });

  it('has a privacy slide and a slide for people who received a credential', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { name: 'Share the proof, not your data' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Received a credential?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see my credentials/i })).toHaveAttribute(
      'href',
      '/app/my-subscriptions',
    );
  });

  it('has no wallet-connect UI — "Go to App" (nav and closing slide) routes into the app instead', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.queryByRole('button', { name: /connect wallet/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /get started/i })).not.toBeInTheDocument();
    const goToApp = screen.getAllByRole('link', { name: /go to app/i });
    expect(goToApp).toHaveLength(2);
    goToApp.forEach((link) => expect(link).toHaveAttribute('href', '/app'));
  });

  it('links the nav "Documentation" item to /docs', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs');
  });

  it('has one dot-nav entry per slide', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('navigation', { name: 'Section navigation' }).querySelectorAll('button')).toHaveLength(9);
  });

  it('says in the footer that it is powered by AdaSouls', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/powered by/i)).toBeInTheDocument();
    expect(screen.getByAltText('AdaSouls').closest('a')).toHaveAttribute('href', 'https://adasouls.io');
    expect(screen.getByText(/© 2026 Velum/)).toBeInTheDocument();
  });

  it('keeps the footer hidden on the hero (it shows from the second screen on)', () => {
    const { container } = renderWithProviders(<Dashboard />);
    const footer = container.querySelector('.landing-fixed-footer');
    expect(footer).not.toHaveClass('is-visible');
    expect(footer).toHaveAttribute('aria-hidden', 'true');
  });
});
