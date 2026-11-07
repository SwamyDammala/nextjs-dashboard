import postgres from 'postgres';
import {
  customers as placeholderCustomers,
  invoices as placeholderInvoices,
  revenue as placeholderRevenue,
} from './placeholder-data';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';

const connectionString =
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  '';

const sql = connectionString ? postgres(connectionString, { ssl: 'require' }) : null;

function getSql() {
  if (!sql) {
    throw new Error(
      'Database is not configured. Add POSTGRES_URL or DATABASE_URL to your environment before querying the database.',
    );
  }

  return sql;
}

function getFallbackCustomers(): CustomerField[] {
  return placeholderCustomers.map((customer) => ({
    id: customer.id,
    name: customer.name,
  }));
}

function getFallbackCustomerById(customerId: string) {
  return placeholderCustomers.find((customer) => customer.id === customerId);
}

function getFallbackInvoice(id: string): InvoiceForm | undefined {
  const invoice = placeholderInvoices.find((entry) => entry.customer_id === id)
    ?? placeholderInvoices[0];

  if (!invoice) {
    return undefined;
  }

  return {
    id: invoice.customer_id,
    customer_id: invoice.customer_id,
    amount: invoice.amount / 100,
    status: invoice.status as InvoiceForm['status'],
  };
}

function getFallbackLatestInvoices(): LatestInvoiceRaw[] {
  return placeholderInvoices.slice(0, 5).map((invoice) => {
    const customer = getFallbackCustomerById(invoice.customer_id);

    return {
      id: invoice.customer_id,
      name: customer?.name ?? 'Unknown customer',
      image_url: customer?.image_url ?? '/customers/evil-rabbit.png',
      email: customer?.email ?? 'unknown@example.com',
      amount: invoice.amount,
    };
  });
}

function getFallbackCardData() {
  const totalPaidInvoices = placeholderInvoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + invoice.amount, 0);
  const totalPendingInvoices = placeholderInvoices
    .filter((invoice) => invoice.status === 'pending')
    .reduce((sum, invoice) => sum + invoice.amount, 0);

  return {
    numberOfCustomers: placeholderCustomers.length,
    numberOfInvoices: placeholderInvoices.length,
    totalPaidInvoices: formatCurrency(totalPaidInvoices),
    totalPendingInvoices: formatCurrency(totalPendingInvoices),
  };
}

function getFallbackFilteredInvoices(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return placeholderInvoices.slice(0, 6);
  }

  return placeholderInvoices.filter((invoice) => {
    const customer = getFallbackCustomerById(invoice.customer_id);
    const haystack = [
      customer?.name ?? '',
      customer?.email ?? '',
      invoice.status,
      String(invoice.amount),
      invoice.date,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export async function fetchRevenue() {
  try {
    if (!connectionString) {
      return placeholderRevenue;
    }

    // Artificially delay a response for demo purposes.
    // Don't do this in production :)

    console.log('Fetching revenue data...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const data = await getSql()<Revenue[]>`SELECT * FROM revenue`;

    console.log('Data fetch completed after 3 seconds.');

    return data;
  } catch (error) {
    console.error('Database Error:', error);
    return placeholderRevenue;
  }
}

export async function fetchLatestInvoices() {
  try {
    if (!connectionString) {
      return getFallbackLatestInvoices().map((invoice) => ({
        ...invoice,
        amount: formatCurrency(invoice.amount),
      }));
    }

    const data = await getSql()<LatestInvoiceRaw[]>`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5`;

    const latestInvoices = data.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    return getFallbackLatestInvoices().map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
  }
}

export async function fetchCardData() {
  try {
    if (!connectionString) {
      return getFallbackCardData();
    }

    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const invoiceCountPromise = getSql()`SELECT COUNT(*) FROM invoices`;
    const customerCountPromise = getSql()`SELECT COUNT(*) FROM customers`;
    const invoiceStatusPromise = getSql()`SELECT
         SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
         SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
         FROM invoices`;

    const data = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(data[0][0].count ?? '0');
    const numberOfCustomers = Number(data[1][0].count ?? '0');
    const totalPaidInvoices = formatCurrency(data[2][0].paid ?? '0');
    const totalPendingInvoices = formatCurrency(data[2][0].pending ?? '0');

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    return getFallbackCardData();
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    if (!connectionString) {
      const fallbackInvoices = getFallbackFilteredInvoices(query)
        .slice(offset, offset + ITEMS_PER_PAGE)
        .map((invoice) => ({
          id: invoice.customer_id,
          customer_id: invoice.customer_id,
          name: getFallbackCustomerById(invoice.customer_id)?.name ?? 'Unknown customer',
          email: getFallbackCustomerById(invoice.customer_id)?.email ?? 'unknown@example.com',
          image_url:
            getFallbackCustomerById(invoice.customer_id)?.image_url ??
            '/customers/evil-rabbit.png',
          date: invoice.date,
          amount: invoice.amount,
          status: invoice.status,
        }));

      return fallbackInvoices;
    }

    const invoices = await getSql()<InvoicesTable[]>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;

    return invoices;
  } catch (error) {
    console.error('Database Error:', error);
    return getFallbackFilteredInvoices(query)
      .slice(offset, offset + ITEMS_PER_PAGE)
      .map((invoice) => ({
        id: invoice.customer_id,
        customer_id: invoice.customer_id,
        name: getFallbackCustomerById(invoice.customer_id)?.name ?? 'Unknown customer',
        email: getFallbackCustomerById(invoice.customer_id)?.email ?? 'unknown@example.com',
        image_url:
          getFallbackCustomerById(invoice.customer_id)?.image_url ??
          '/customers/evil-rabbit.png',
        date: invoice.date,
        amount: invoice.amount,
        status: invoice.status,
      }));
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    if (!connectionString) {
      return 1;
    }

    const data = await getSql()`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(data[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    return 1;
  }
}

export async function fetchInvoiceById(id: string): Promise<InvoiceForm> {
  try {
    if (!connectionString) {
      const fallbackInvoice = getFallbackInvoice(id);
      if (!fallbackInvoice) {
        throw new Error(`Invoice not found for id: ${id}`);
      }
      return fallbackInvoice;
    }

    const data = await getSql()<InvoiceForm[]>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = data.map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    if (!invoice[0]) {
      throw new Error(`Invoice not found for id: ${id}`);
    }

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    const fallbackInvoice = getFallbackInvoice(id);
    if (!fallbackInvoice) {
      throw new Error('Failed to fetch invoice.');
    }
    return fallbackInvoice;
  }
}

export async function fetchCustomers(): Promise<CustomerField[]> {
  try {
    if (!connectionString) {
      return getFallbackCustomers();
    }

    const customers = await getSql()<CustomerField[]>`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    return getFallbackCustomers();
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    if (!connectionString) {
      const customers = getFallbackCustomers().filter((customer) => {
        const match = `${customer.name}`.toLowerCase();
        return match.includes(query.toLowerCase());
      });

      return customers.map((customer) => ({
        ...customer,
        email: placeholderCustomers.find((entry) => entry.id === customer.id)?.email ?? '',
        image_url: placeholderCustomers.find((entry) => entry.id === customer.id)?.image_url ?? '',
        total_invoices: 0,
        total_pending: 0,
        total_paid: 0,
      }));
    }

    const data = await getSql()<CustomersTableType[]>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    const customers = getFallbackCustomers().filter((customer) =>
      customer.name.toLowerCase().includes(query.toLowerCase()),
    );

    return customers.map((customer) => ({
      ...customer,
      email: placeholderCustomers.find((entry) => entry.id === customer.id)?.email ?? '',
      image_url: placeholderCustomers.find((entry) => entry.id === customer.id)?.image_url ?? '',
      total_invoices: 0,
      total_pending: 0,
      total_paid: 0,
    }));
  }
}
