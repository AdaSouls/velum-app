import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventFilters from '../../jsx/components/EventFilters';

describe('EventFilters Component', () => {
  const mockOnFilterChange = jest.fn();
  const mockOnReset = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const openPopover = async () => {
    await userEvent.click(screen.getByRole('button', { name: /filters/i }));
  };

  it('renders a filter icon button, closed by default', () => {
    render(<EventFilters filters={{}} onFilterChange={mockOnFilterChange} onReset={mockOnReset} />);
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
    expect(screen.queryByText(/Filters & Sort/i)).not.toBeInTheDocument();
  });

  it('opens the popover and shows filter fields', async () => {
    render(<EventFilters filters={{}} onFilterChange={mockOnFilterChange} onReset={mockOnReset} />);

    await openPopover();

    expect(screen.getByText(/Filters & Sort/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Event ID contains/i)).toBeInTheDocument();
  });

  it('calls onFilterChange when event id search is entered', async () => {
    render(<EventFilters filters={{}} onFilterChange={mockOnFilterChange} onReset={mockOnReset} />);

    await openPopover();
    await userEvent.type(screen.getByLabelText(/Event ID contains/i), 'ab');

    expect(mockOnFilterChange).toHaveBeenCalled();
  });

  it('calls onFilterChange when status is selected', async () => {
    render(<EventFilters filters={{}} onFilterChange={mockOnFilterChange} onReset={mockOnReset} />);

    await openPopover();
    await userEvent.click(screen.getByLabelText(/^Status$/i));
    await userEvent.click(screen.getByRole('option', { name: 'Active' }));

    expect(mockOnFilterChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  // The option list is portalled to <body>, outside the popover's own DOM node — picking from it
  // must not count as a click outside the popover (see FilterPopover.jsx).
  it('keeps the popover open after picking from a dropdown, and still closes on an outside press', async () => {
    render(<EventFilters filters={{}} onFilterChange={mockOnFilterChange} onReset={mockOnReset} />);

    await openPopover();
    await userEvent.click(screen.getByLabelText(/^Sort By$/i));
    await userEvent.click(screen.getByRole('option', { name: 'Minted' }));

    expect(mockOnFilterChange).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'minted' }));
    expect(screen.getByText(/Filters & Sort/i)).toBeInTheDocument();

    await userEvent.click(document.body);

    expect(screen.queryByText(/Filters & Sort/i)).not.toBeInTheDocument();
  });

  it('calls onReset when clear button is clicked', async () => {
    render(
      <EventFilters
        filters={{ eventIdSearch: 'ab', status: 'active' }}
        onFilterChange={mockOnFilterChange}
        onReset={mockOnReset}
      />
    );

    await openPopover();
    await userEvent.click(screen.getByTitle(/clear all filters/i));

    expect(mockOnReset).toHaveBeenCalled();
  });
});
