-- GreenSync Database Migration for Supabase
-- Generated: Sun Mar 22 08:33:00 PM UTC 2026

-- ============================================
-- SCHEMA
-- ============================================
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id integer NOT NULL,
    company_id integer,
    user_id integer,
    admin_id integer,
    action text NOT NULL,
    entity_type text,
    entity_id integer,
    metadata_json json,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_logs_id_seq OWNED BY public.activity_logs.id;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    property_id integer,
    service_id integer,
    assigned_user_id integer,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_start timestamp without time zone NOT NULL,
    scheduled_end timestamp without time zone,
    price numeric(10,2),
    notes text,
    internal_notes text,
    reminder_sent boolean DEFAULT false NOT NULL,
    completion_notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.appointments_id_seq OWNED BY public.appointments.id;


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id integer NOT NULL,
    company_id integer NOT NULL,
    name text NOT NULL,
    trigger_type text NOT NULL,
    action_type text NOT NULL,
    config_json json,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_rules_id_seq OWNED BY public.automation_rules.id;


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id integer NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    primary_color text,
    phone text,
    email text,
    address text,
    city text,
    state text,
    zip text,
    website text,
    timezone text DEFAULT 'America/New_York'::text,
    subscription_plan text,
    subscription_status text,
    stripe_customer_id text,
    stripe_subscription_id text,
    trial_ends_at timestamp without time zone,
    current_period_end timestamp without time zone,
    cancel_at_period_end boolean DEFAULT false,
    review_url text,
    internal_notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: companies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.companies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.companies_id_seq OWNED BY public.companies.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    company_id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    address_line_1 text,
    address_line_2 text,
    city text,
    state text,
    zip text,
    notes text,
    lead_source text,
    tags json DEFAULT '[]'::json,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: estimates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estimates (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    property_id integer,
    estimate_number text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    total numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: estimates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estimates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estimates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estimates_id_seq OWNED BY public.estimates.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    appointment_id integer,
    invoice_number text NOT NULL,
    subtotal numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    tax numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    total numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    due_date timestamp without time zone,
    paid_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_admins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_admins_id_seq OWNED BY public.platform_admins.id;


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    property_name text,
    address_line_1 text NOT NULL,
    address_line_2 text,
    city text,
    state text,
    zip text,
    gate_notes text,
    yard_size text,
    property_notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: properties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.properties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: properties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.properties_id_seq OWNED BY public.properties.id;


--
-- Name: recurring_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_plans (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    property_id integer,
    service_id integer,
    frequency_type text NOT NULL,
    interval_value integer,
    day_of_week integer,
    day_of_month integer,
    next_run_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL,
    price numeric(10,2),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: recurring_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recurring_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recurring_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recurring_plans_id_seq OWNED BY public.recurring_plans.id;


--
-- Name: review_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_requests (
    id integer NOT NULL,
    company_id integer NOT NULL,
    customer_id integer NOT NULL,
    appointment_id integer,
    sent_at timestamp without time zone,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    review_url text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: review_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.review_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.review_requests_id_seq OWNED BY public.review_requests.id;


--
-- Name: route_stops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_stops (
    id integer NOT NULL,
    company_id integer NOT NULL,
    route_id integer NOT NULL,
    appointment_id integer NOT NULL,
    stop_order integer NOT NULL,
    estimated_arrival timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: route_stops_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.route_stops_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: route_stops_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.route_stops_id_seq OWNED BY public.route_stops.id;


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routes (
    id integer NOT NULL,
    company_id integer NOT NULL,
    route_date timestamp without time zone NOT NULL,
    assigned_user_id integer,
    status text DEFAULT 'planned'::text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: routes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routes_id_seq OWNED BY public.routes.id;


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id integer NOT NULL,
    company_id integer NOT NULL,
    name text NOT NULL,
    description text,
    duration_minutes integer,
    base_price numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    category text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    company_id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    phone text,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: activity_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs ALTER COLUMN id SET DEFAULT nextval('public.activity_logs_id_seq'::regclass);


--
-- Name: appointments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments ALTER COLUMN id SET DEFAULT nextval('public.appointments_id_seq'::regclass);


--
-- Name: automation_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules ALTER COLUMN id SET DEFAULT nextval('public.automation_rules_id_seq'::regclass);


--
-- Name: companies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies ALTER COLUMN id SET DEFAULT nextval('public.companies_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: estimates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates ALTER COLUMN id SET DEFAULT nextval('public.estimates_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: platform_admins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins ALTER COLUMN id SET DEFAULT nextval('public.platform_admins_id_seq'::regclass);


--
-- Name: properties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties ALTER COLUMN id SET DEFAULT nextval('public.properties_id_seq'::regclass);


--
-- Name: recurring_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_plans ALTER COLUMN id SET DEFAULT nextval('public.recurring_plans_id_seq'::regclass);


--
-- Name: review_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests ALTER COLUMN id SET DEFAULT nextval('public.review_requests_id_seq'::regclass);


--
-- Name: route_stops id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops ALTER COLUMN id SET DEFAULT nextval('public.route_stops_id_seq'::regclass);


--
-- Name: routes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes ALTER COLUMN id SET DEFAULT nextval('public.routes_id_seq'::regclass);


--
-- Name: services id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: companies companies_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_slug_unique UNIQUE (slug);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: estimates estimates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_email_unique UNIQUE (email);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: recurring_plans recurring_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_plans
    ADD CONSTRAINT recurring_plans_pkey PRIMARY KEY (id);


--
-- Name: review_requests review_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_pkey PRIMARY KEY (id);


--
-- Name: route_stops route_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_pkey PRIMARY KEY (id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: automation_rules automation_rules_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: customers customers_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: estimates estimates_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: estimates estimates_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estimates
    ADD CONSTRAINT estimates_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: invoices invoices_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: properties properties_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: properties properties_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: recurring_plans recurring_plans_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_plans
    ADD CONSTRAINT recurring_plans_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: recurring_plans recurring_plans_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_plans
    ADD CONSTRAINT recurring_plans_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: review_requests review_requests_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: review_requests review_requests_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_requests
    ADD CONSTRAINT review_requests_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: route_stops route_stops_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_route_id_routes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_route_id_routes_id_fk FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: routes routes_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: services services_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: users users_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 3ePmd33IHqi9x5CG8ajhzK5jMU6bpaNNEjHd1y5jskxfS3RIgBJS8vyyPfTnfYE


-- ============================================
-- DATA
-- ============================================
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (1, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 07:20:23.547358');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (2, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 07:20:30.85073');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (3, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 07:32:36.49825');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (4, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 07:34:06.821448');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (5, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 07:35:10.890291');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (6, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:00:25.25175');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (7, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:03:16.66823');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (8, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 15:06:09.829754');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (9, 1, 1, NULL, 'customer.created', 'customer', 1, '{"name":"James Harrison"}', '2026-03-02 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (10, 1, 1, NULL, 'customer.created', 'customer', 2, '{"name":"Maria Santos"}', '2026-03-03 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (11, 1, 1, NULL, 'appointment.created', 'appointment', 1, '{}', '2026-03-06 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (12, 1, 1, NULL, 'appointment.created', 'appointment', 6, '{}', '2026-03-21 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (13, 1, 1, NULL, 'invoice.created', 'invoice', 4, '{"number":"INV-0004"}', '2026-03-16 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (14, 1, 1, NULL, 'invoice.paid', 'invoice', 1, '{"number":"INV-0001"}', '2026-03-10 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (15, 1, 1, NULL, 'invoice.paid', 'invoice', 2, '{"number":"INV-0002"}', '2026-03-13 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (16, 1, 1, NULL, 'estimate.created', 'estimate', 1, '{"number":"EST-0001"}', '2026-03-19 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (17, 1, 1, NULL, 'review_request.sent', 'review_request', 1, '{"channel":"email"}', '2026-03-08 15:12:49.199789');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (18, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:13:00.52238');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (19, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:13:06.771438');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (20, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:15:48.251604');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (21, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:17:58.096282');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (22, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 15:20:22.238691');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (23, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 15:20:28.447888');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (24, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 15:20:28.77953');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (25, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:22:52.96853');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (26, 1, 1, NULL, 'user.login', 'user', 1, NULL, '2026-03-22 15:25:27.753641');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (27, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 15:26:25.110864');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (28, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 17:02:40.094998');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (29, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 17:13:46.890316');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (30, NULL, NULL, 1, 'admin.company_plan_changed', 'company', 1, '{"plan":"pro"}', '2026-03-22 17:14:15.089327');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (31, NULL, NULL, 1, 'admin.company_plan_changed', 'company', 1, '{"plan":"growth"}', '2026-03-22 17:14:26.288699');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (32, NULL, NULL, 1, 'admin.login', 'admin', 1, NULL, '2026-03-22 20:02:17.358521');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (33, NULL, NULL, 1, 'admin.company_plan_changed', 'company', 5, '{"plan":"pro"}', '2026-03-22 20:04:43.182434');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (34, NULL, NULL, 1, 'admin.company_suspended', 'company', 5, NULL, '2026-03-22 20:04:47.75954');
INSERT INTO public.activity_logs (id, company_id, user_id, admin_id, action, entity_type, entity_id, metadata_json, created_at) VALUES (35, 2, 2, NULL, 'user.login', 'user', 2, NULL, '2026-03-22 20:06:00.84801');


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (2, 'LawnPro Solo', 'lawnpro-solo', NULL, NULL, '512-555-1001', 'owner@lawnpro.com', '101 Spruce St', 'Houston', 'TX', '77001', NULL, 'America/New_York', 'starter', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:02.654134', '2026-03-22 17:09:02.654134');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (3, 'Green Thumb LLC', 'greenthumb-llc', NULL, NULL, '512-555-1002', 'owner@greenthumb.com', '202 Willow Ave', 'Dallas', 'TX', '75001', NULL, 'America/New_York', 'starter', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:02.654134', '2026-03-22 17:09:02.654134');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (4, 'CutRight Services', 'cutright-svc', NULL, NULL, '512-555-1003', 'owner@cutright.com', '303 Aspen Rd', 'San Antonio', 'TX', '78201', NULL, 'America/New_York', 'starter', 'trialing', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:02.654134', '2026-03-22 17:09:02.654134');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (6, 'EverGreen Solutions', 'evergreen-sol', NULL, NULL, '512-555-2002', 'owner@evergreen.com', '505 Magnolia Dr', 'Fort Worth', 'TX', '76101', NULL, 'America/New_York', 'growth', 'trialing', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:06.360045', '2026-03-22 17:09:06.360045');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (7, 'Elite Lawn Systems', 'elite-lawn', NULL, NULL, '512-555-3001', 'owner@elitelawn.com', '606 Cypress Way', 'Austin', 'TX', '78703', NULL, 'America/New_York', 'pro', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:10.269263', '2026-03-22 17:09:10.269263');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (8, 'TurfMaster Pro', 'turfmaster-pro', NULL, NULL, '512-555-3002', 'owner@turfmaster.com', '707 Pecan Ln', 'Plano', 'TX', '75024', NULL, 'America/New_York', 'pro', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:10.269263', '2026-03-22 17:09:10.269263');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (9, 'GreenWave Enterprise', 'greenwave-ent', NULL, NULL, '512-555-3003', 'owner@greenwave.com', '808 Walnut Cir', 'Arlington', 'TX', '76010', NULL, 'America/New_York', 'pro', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 17:09:10.269263', '2026-03-22 17:09:10.269263');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (1, 'GreenScapes Pro', 'greenscapes-demo', NULL, NULL, '555-123-4567', 'demo@greenscapes.com', '123 Lawn Lane', 'Austin', 'TX', '78701', NULL, 'America/New_York', 'growth', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, true, '2026-03-22 07:20:23.612509', '2026-03-22 17:14:26.276');
INSERT INTO public.companies (id, name, slug, logo_url, primary_color, phone, email, address, city, state, zip, website, timezone, subscription_plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end, review_url, internal_notes, is_active, created_at, updated_at) VALUES (5, 'Precision Lawn Care', 'precision-lawn', NULL, NULL, '512-555-2001', 'owner@precision.com', '404 Birch Blvd', 'Austin', 'TX', '78702', NULL, 'America/New_York', 'pro', 'active', NULL, NULL, NULL, NULL, false, NULL, NULL, false, '2026-03-22 17:09:06.360045', '2026-03-22 20:04:47.755');


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (1, 1, 'James', 'Harrison', 'james.harrison@email.com', '512-555-0101', '412 Cedar Blvd', NULL, 'Austin', 'TX', '78701', NULL, 'referral', '["vip"]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (2, 1, 'Maria', 'Santos', 'maria.santos@email.com', '512-555-0102', '809 Oak Drive', NULL, 'Austin', 'TX', '78702', NULL, 'google', '[]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (3, 1, 'David', 'Chen', 'david.chen@email.com', '512-555-0103', '1203 Elm St', NULL, 'Austin', 'TX', '78703', NULL, 'website', '[]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (4, 1, 'Rachel', 'Thompson', 'rachel.t@email.com', '512-555-0104', '56 Maple Ave', NULL, 'Austin', 'TX', '78704', NULL, 'referral', '["vip"]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (5, 1, 'Tom', 'Williams', 'tom.williams@email.com', '512-555-0105', '334 Pine Rd', NULL, 'Austin', 'TX', '78705', NULL, 'google', '[]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (6, 1, 'Linda', 'Garcia', 'linda.garcia@email.com', '512-555-0106', '720 Birch Lane', NULL, 'Austin', 'TX', '78706', NULL, 'instagram', '[]', '2026-03-22 15:10:53.263564', '2026-03-22 15:10:53.263564');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (7, 2, 'Tom', 'Bradley', 'tom.b@email.com', '713-555-1001', '12 Oak Ln', NULL, 'Houston', 'TX', '77002', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (8, 2, 'Paula', 'Chen', 'paula.c@email.com', '713-555-1002', '34 Pine St', NULL, 'Houston', 'TX', '77003', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (9, 2, 'Mark', 'Wilson', 'mark.w@email.com', '713-555-1003', '56 Elm Ave', NULL, 'Houston', 'TX', '77004', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (10, 3, 'Linda', 'Foster', 'linda.f@email.com', '214-555-2001', '78 Maple Dr', NULL, 'Dallas', 'TX', '75002', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (11, 3, 'Steve', 'Adams', 'steve.a@email.com', '214-555-2002', '90 Cedar Blvd', NULL, 'Dallas', 'TX', '75003', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (12, 3, 'Nancy', 'Baker', 'nancy.b@email.com', '214-555-2003', '22 Birch Ct', NULL, 'Dallas', 'TX', '75004', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (13, 4, 'Oscar', 'Reyes', 'oscar.r@email.com', '210-555-3001', '44 Spruce Way', NULL, 'San Antonio', 'TX', '78202', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (14, 4, 'Beth', 'Collins', 'beth.c@email.com', '210-555-3002', '66 Willow Rd', NULL, 'San Antonio', 'TX', '78203', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (15, 4, 'Frank', 'Turner', 'frank.t@email.com', '210-555-3003', '88 Ash St', NULL, 'San Antonio', 'TX', '78204', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (16, 5, 'Grace', 'Hudson', 'grace.h@email.com', '512-555-4001', '100 Peach Pl', NULL, 'Austin', 'TX', '78703', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (17, 5, 'Tim', 'Ward', 'tim.w@email.com', '512-555-4002', '200 Cherry Ln', NULL, 'Austin', 'TX', '78704', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (18, 5, 'Karen', 'Simmons', 'karen.s@email.com', '512-555-4003', '300 Plum Ave', NULL, 'Austin', 'TX', '78705', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (19, 6, 'Brian', 'Hughes', 'brian.h@email.com', '817-555-5001', '400 Pear Dr', NULL, 'Fort Worth', 'TX', '76102', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (20, 6, 'Donna', 'Ross', 'donna.r@email.com', '817-555-5002', '500 Apple Blvd', NULL, 'Fort Worth', 'TX', '76103', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (21, 6, 'Kevin', 'Scott', 'kevin.s@email.com', '817-555-5003', '600 Grape St', NULL, 'Fort Worth', 'TX', '76104', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (22, 7, 'Rachel', 'Mitchell', 'rachel.m@email.com', '512-555-6001', '700 Mango Ct', NULL, 'Austin', 'TX', '78706', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (23, 7, 'Jason', 'Carter', 'jason.c@email.com', '512-555-6002', '800 Lime Way', NULL, 'Austin', 'TX', '78707', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (24, 7, 'Amy', 'Phillips', 'amy.p@email.com', '512-555-6003', '900 Lemon Pl', NULL, 'Austin', 'TX', '78708', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (25, 8, 'Daniel', 'Campbell', 'daniel.c@email.com', '972-555-7001', '101 Kiwi Dr', NULL, 'Plano', 'TX', '75025', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (26, 8, 'Rebecca', 'Parker', 'rebecca.p@email.com', '972-555-7002', '202 Berry Blvd', NULL, 'Plano', 'TX', '75026', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (27, 8, 'Tyler', 'Evans', 'tyler.e@email.com', '972-555-7003', '303 Nectarine Ln', NULL, 'Plano', 'TX', '75027', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (28, 9, 'Sandra', 'Bell', 'sandra.b@email.com', '682-555-8001', '404 Coconut Ave', NULL, 'Arlington', 'TX', '76011', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (29, 9, 'Jeremy', 'Gray', 'jeremy.g@email.com', '682-555-8002', '505 Papaya St', NULL, 'Arlington', 'TX', '76012', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');
INSERT INTO public.customers (id, company_id, first_name, last_name, email, phone, address_line_1, address_line_2, city, state, zip, notes, lead_source, tags, created_at, updated_at) VALUES (30, 9, 'Melissa', 'Wood', 'melissa.w@email.com', '682-555-8003', '606 Guava Ct', NULL, 'Arlington', 'TX', '76013', NULL, NULL, '[]', '2026-03-22 17:10:40.515287', '2026-03-22 17:10:40.515287');


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (1, 1, 1, 1, 1, 1, 'completed', '2026-03-07 15:11:22.026544', '2026-03-07 16:11:22.026544', 65.00, 'Full mow and edge', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (2, 1, 2, 2, 1, 1, 'completed', '2026-03-10 15:11:22.026544', '2026-03-10 16:11:22.026544', 65.00, NULL, NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (3, 1, 4, 4, 3, 1, 'completed', '2026-03-12 15:11:22.026544', '2026-03-12 16:41:22.026544', 120.00, 'VIP - all hedges trimmed', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (4, 1, 3, 3, 2, 1, 'completed', '2026-03-15 15:11:22.026544', '2026-03-15 15:56:22.026544', 89.00, 'Spring fert applied', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (5, 1, 5, 5, 1, 1, 'completed', '2026-03-17 15:11:22.026544', '2026-03-17 16:11:22.026544', 65.00, NULL, NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (6, 1, 1, 1, 1, 1, 'scheduled', '2026-03-22 16:11:22.026544', '2026-03-22 17:11:22.026544', 65.00, 'Regular bi-weekly mow', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (7, 1, 4, 4, 1, 1, 'scheduled', '2026-03-22 18:11:22.026544', '2026-03-22 19:11:22.026544', 65.00, 'VIP priority slot', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (8, 1, 6, 6, 1, 1, 'scheduled', '2026-03-23 15:11:22.026544', '2026-03-23 16:11:22.026544', 65.00, 'First visit — front only', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (9, 1, 2, 2, 4, 1, 'scheduled', '2026-03-25 15:11:22.026544', '2026-03-25 16:26:22.026544', 150.00, 'Spring aeration', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (10, 1, 3, 3, 5, 1, 'scheduled', '2026-03-29 15:11:22.026544', '2026-03-29 17:11:22.026544', 175.00, 'Leaf cleanup after storm', NULL, false, NULL, '2026-03-22 15:11:22.026544', '2026-03-22 15:11:22.026544');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (11, 2, 7, NULL, 6, 2, 'completed', '2026-03-10 09:00:00', '2026-03-10 10:00:00', 55.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (12, 2, 8, NULL, 6, 2, 'scheduled', '2026-03-25 10:00:00', '2026-03-25 11:00:00', 55.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (13, 2, 9, NULL, 7, 2, 'scheduled', '2026-04-02 14:00:00', '2026-04-02 15:30:00', 95.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (14, 3, 10, NULL, 8, 3, 'completed', '2026-03-12 08:00:00', '2026-03-12 09:00:00', 60.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (15, 3, 11, NULL, 9, 3, 'scheduled', '2026-03-26 13:00:00', '2026-03-26 13:45:00', 80.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (16, 3, 12, NULL, 8, 3, 'scheduled', '2026-04-05 11:00:00', '2026-04-05 12:00:00', 60.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (17, 4, 13, NULL, 10, 4, 'completed', '2026-03-08 07:00:00', '2026-03-08 08:15:00', 65.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (18, 4, 14, NULL, 11, 4, 'scheduled', '2026-03-27 09:00:00', '2026-03-27 10:30:00', 110.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (19, 4, 15, NULL, 10, 4, 'in_progress', '2026-03-22 08:00:00', '2026-03-22 09:15:00', 65.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (20, 5, 16, NULL, 12, 5, 'completed', '2026-03-05 10:00:00', '2026-03-05 11:00:00', 70.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (21, 5, 17, NULL, 13, 5, 'scheduled', '2026-03-28 09:00:00', '2026-03-28 10:15:00', 145.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (22, 5, 18, NULL, 12, 5, 'scheduled', '2026-04-08 14:00:00', '2026-04-08 15:00:00', 70.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (23, 6, 19, NULL, 14, 6, 'completed', '2026-03-11 08:30:00', '2026-03-11 09:30:00', 65.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (24, 6, 20, NULL, 15, 6, 'scheduled', '2026-03-29 10:00:00', '2026-03-29 10:45:00', 85.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (25, 6, 21, NULL, 14, 6, 'scheduled', '2026-04-10 13:00:00', '2026-04-10 14:00:00', 65.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (26, 7, 22, NULL, 16, 7, 'completed', '2026-03-03 09:00:00', '2026-03-03 11:00:00', 135.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (27, 7, 23, NULL, 17, 7, 'scheduled', '2026-03-30 08:00:00', '2026-03-30 10:00:00', 225.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (28, 7, 24, NULL, 16, 7, 'scheduled', '2026-04-12 10:00:00', '2026-04-12 12:00:00', 135.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (29, 8, 25, NULL, 18, 8, 'completed', '2026-03-06 07:30:00', '2026-03-06 09:00:00', 95.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (30, 8, 26, NULL, 19, 8, 'scheduled', '2026-04-01 10:00:00', '2026-04-01 13:00:00', 450.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (31, 8, 27, NULL, 18, 8, 'scheduled', '2026-04-15 08:00:00', '2026-04-15 09:30:00', 95.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (32, 9, 28, NULL, 20, 9, 'completed', '2026-03-09 06:00:00', '2026-03-09 08:00:00', 195.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (33, 9, 29, NULL, 21, 9, 'scheduled', '2026-04-03 09:00:00', '2026-04-03 10:00:00', 175.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');
INSERT INTO public.appointments (id, company_id, customer_id, property_id, service_id, assigned_user_id, status, scheduled_start, scheduled_end, price, notes, internal_notes, reminder_sent, completion_notes, created_at, updated_at) VALUES (34, 9, 30, NULL, 20, 9, 'scheduled', '2026-04-18 07:00:00', '2026-04-18 09:00:00', 195.00, NULL, NULL, false, NULL, '2026-03-22 17:11:21.624505', '2026-03-22 17:11:21.624505');


--
-- Data for Name: automation_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.automation_rules (id, company_id, name, trigger_type, action_type, config_json, is_active, created_at, updated_at) VALUES (1, 1, 'Auto-invoice on job complete', 'appointment_completed', 'create_invoice', '{"dueInDays":14}', true, '2026-03-22 15:12:07.189773', '2026-03-22 15:12:07.189773');
INSERT INTO public.automation_rules (id, company_id, name, trigger_type, action_type, config_json, is_active, created_at, updated_at) VALUES (2, 1, 'Review request after invoice paid', 'invoice_paid', 'send_review_request', '{"channel":"email","delayHours":24}', true, '2026-03-22 15:12:07.189773', '2026-03-22 15:12:07.189773');
INSERT INTO public.automation_rules (id, company_id, name, trigger_type, action_type, config_json, is_active, created_at, updated_at) VALUES (3, 1, 'SMS reminder 24h before appointment', 'appointment_scheduled', 'send_sms', '{"message":"Reminder: Your GreenScapes service is tomorrow. Reply STOP to cancel.","offsetHours":-24}', false, '2026-03-22 15:12:07.189773', '2026-03-22 15:12:07.189773');


--
-- Data for Name: estimates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.estimates (id, company_id, customer_id, property_id, estimate_number, status, total, notes, created_at, updated_at) VALUES (1, 1, 6, 6, 'EST-0001', 'sent', 520.00, 'Full season package: mowing + fertilization + cleanup', '2026-03-22 15:11:55.753531', '2026-03-22 15:11:55.753531');
INSERT INTO public.estimates (id, company_id, customer_id, property_id, estimate_number, status, total, notes, created_at, updated_at) VALUES (2, 1, 2, 2, 'EST-0002', 'approved', 150.00, 'Spring aeration service', '2026-03-22 15:11:55.753531', '2026-03-22 15:11:55.753531');
INSERT INTO public.estimates (id, company_id, customer_id, property_id, estimate_number, status, total, notes, created_at, updated_at) VALUES (3, 1, 5, 5, 'EST-0003', 'draft', 350.00, 'Annual hedge trimming + 6 mows', '2026-03-22 15:11:55.753531', '2026-03-22 15:11:55.753531');


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (1, 1, 1, 1, 'INV-0001', 65.00, 5.20, 70.20, 'paid', '2026-03-12 15:11:36.509339', '2026-03-10 15:11:36.509339', NULL, '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');
INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (2, 1, 2, 2, 'INV-0002', 65.00, 5.20, 70.20, 'paid', '2026-03-15 15:11:36.509339', '2026-03-13 15:11:36.509339', NULL, '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');
INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (3, 1, 4, 3, 'INV-0003', 120.00, 9.60, 129.60, 'paid', '2026-03-17 15:11:36.509339', '2026-03-15 15:11:36.509339', 'VIP quarterly hedge', '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');
INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (4, 1, 3, 4, 'INV-0004', 89.00, 7.12, 96.12, 'sent', '2026-03-29 15:11:36.509339', NULL, 'Spring fertilization', '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');
INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (5, 1, 5, 5, 'INV-0005', 65.00, 5.20, 70.20, 'sent', '2026-04-05 15:11:36.509339', NULL, NULL, '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');
INSERT INTO public.invoices (id, company_id, customer_id, appointment_id, invoice_number, subtotal, tax, total, status, due_date, paid_at, notes, created_at, updated_at) VALUES (6, 1, 1, NULL, 'INV-0006', 65.00, 5.20, 70.20, 'draft', '2026-04-05 15:11:36.509339', NULL, 'Today''s service — pending', '2026-03-22 15:11:36.509339', '2026-03-22 15:11:36.509339');


--
-- Data for Name: platform_admins; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.platform_admins (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at) VALUES (1, 'admin@greensync.com', '$2b$12$6pFhlCGr3CBCfTN81lsd8ec9yNQS8L3578T4RDmZo9F8cGj835h8C', 'Super', 'Admin', 'superadmin', true, '2026-03-22 07:20:18.543435', '2026-03-22 07:20:18.543435');


--
-- Data for Name: properties; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (1, 1, 1, 'Harrison Residence', '412 Cedar Blvd', NULL, 'Austin', 'TX', '78701', NULL, 'large', 'Fenced back yard, gate code 4821', '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');
INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (2, 1, 2, 'Santos Home', '809 Oak Drive', NULL, 'Austin', 'TX', '78702', NULL, 'medium', 'Dog on property — call ahead', '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');
INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (3, 1, 3, 'Chen Property', '1203 Elm St', NULL, 'Austin', 'TX', '78703', NULL, 'small', 'Corner lot', '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');
INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (4, 1, 4, 'Thompson Estate', '56 Maple Ave', NULL, 'Austin', 'TX', '78704', NULL, 'large', 'VIP — priority scheduling', '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');
INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (5, 1, 5, 'Williams Yard', '334 Pine Rd', NULL, 'Austin', 'TX', '78705', NULL, 'medium', NULL, '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');
INSERT INTO public.properties (id, company_id, customer_id, property_name, address_line_1, address_line_2, city, state, zip, gate_notes, yard_size, property_notes, created_at, updated_at) VALUES (6, 1, 6, 'Garcia Residence', '720 Birch Lane', NULL, 'Austin', 'TX', '78706', NULL, 'small', 'New customer - front yard only', '2026-03-22 15:11:05.67253', '2026-03-22 15:11:05.67253');


--
-- Data for Name: recurring_plans; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.recurring_plans (id, company_id, customer_id, property_id, service_id, frequency_type, interval_value, day_of_week, day_of_month, next_run_at, is_active, price, created_at, updated_at) VALUES (1, 1, 1, 1, 1, 'weekly', 2, NULL, NULL, '2026-03-27 15:11:59.5954', true, 65.00, '2026-03-22 15:11:59.5954', '2026-03-22 15:11:59.5954');
INSERT INTO public.recurring_plans (id, company_id, customer_id, property_id, service_id, frequency_type, interval_value, day_of_week, day_of_month, next_run_at, is_active, price, created_at, updated_at) VALUES (2, 1, 4, 4, 1, 'weekly', 2, NULL, NULL, '2026-03-25 15:11:59.5954', true, 65.00, '2026-03-22 15:11:59.5954', '2026-03-22 15:11:59.5954');
INSERT INTO public.recurring_plans (id, company_id, customer_id, property_id, service_id, frequency_type, interval_value, day_of_week, day_of_month, next_run_at, is_active, price, created_at, updated_at) VALUES (3, 1, 3, 3, 2, 'monthly', 1, NULL, NULL, '2026-04-12 15:11:59.5954', true, 89.00, '2026-03-22 15:11:59.5954', '2026-03-22 15:11:59.5954');


--
-- Data for Name: review_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.review_requests (id, company_id, customer_id, appointment_id, sent_at, channel, status, review_url, created_at, updated_at) VALUES (1, 1, 1, 1, '2026-03-08 15:12:03.232945', 'email', 'sent', 'https://g.page/greenscapes/review', '2026-03-22 15:12:03.232945', '2026-03-22 15:12:03.232945');
INSERT INTO public.review_requests (id, company_id, customer_id, appointment_id, sent_at, channel, status, review_url, created_at, updated_at) VALUES (2, 1, 2, 2, '2026-03-11 15:12:03.232945', 'sms', 'sent', 'https://g.page/greenscapes/review', '2026-03-22 15:12:03.232945', '2026-03-22 15:12:03.232945');
INSERT INTO public.review_requests (id, company_id, customer_id, appointment_id, sent_at, channel, status, review_url, created_at, updated_at) VALUES (3, 1, 4, 3, '2026-03-13 15:12:03.232945', 'email', 'sent', 'https://g.page/greenscapes/review', '2026-03-22 15:12:03.232945', '2026-03-22 15:12:03.232945');


--
-- Data for Name: routes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.routes (id, company_id, route_date, assigned_user_id, status, notes, created_at, updated_at) VALUES (1, 1, '2026-03-22 00:00:00', 1, 'active', 'Morning route — 4 stops', '2026-03-22 15:12:23.697147', '2026-03-22 15:12:23.697147');


--
-- Data for Name: route_stops; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (1, 1, 'Lawn Mowing', 'Full lawn mowing and edging service', 60, 65.00, true, 'maintenance', '2026-03-22 15:10:39.471556', '2026-03-22 15:10:39.471556');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (2, 1, 'Fertilization', 'Seasonal fertilization treatment', 45, 89.00, true, 'treatment', '2026-03-22 15:10:39.471556', '2026-03-22 15:10:39.471556');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (3, 1, 'Hedge Trimming', 'Hedge and shrub trimming service', 90, 120.00, true, 'maintenance', '2026-03-22 15:10:39.471556', '2026-03-22 15:10:39.471556');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (4, 1, 'Aeration', 'Core aeration for lawn health', 75, 150.00, true, 'treatment', '2026-03-22 15:10:39.471556', '2026-03-22 15:10:39.471556');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (5, 1, 'Leaf Removal', 'Full property leaf cleanup', 120, 175.00, true, 'seasonal', '2026-03-22 15:10:39.471556', '2026-03-22 15:10:39.471556');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (6, 2, 'Lawn Mowing', 'Basic mow and edge', 60, 55.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (7, 2, 'Leaf Cleanup', 'Seasonal leaf removal', 90, 95.00, true, 'seasonal', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (8, 3, 'Lawn Mowing', 'Full lawn mow', 60, 60.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (9, 3, 'Fertilization', 'Seasonal fertilizer treatment', 45, 80.00, true, 'treatment', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (10, 4, 'Lawn Mowing', 'Mow, edge, and blow', 75, 65.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (11, 4, 'Hedge Trimming', 'Shrub and hedge shaping', 90, 110.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (12, 5, 'Lawn Mowing', 'Premium bi-weekly mow', 60, 70.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (13, 5, 'Aeration', 'Core aeration service', 75, 145.00, true, 'treatment', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (14, 6, 'Lawn Mowing', 'Full mowing service', 60, 65.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (15, 6, 'Fertilization', 'Year-round fertilization', 45, 85.00, true, 'treatment', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (16, 7, 'Full Lawn Service', 'Mow, edge, fertilize, blow', 120, 135.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (17, 7, 'Aeration & Seeding', 'Aeration plus overseeding', 120, 225.00, true, 'treatment', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (18, 8, 'Lawn Maintenance', 'Complete weekly care', 90, 95.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (19, 8, 'Landscaping', 'Full landscape design service', 180, 450.00, true, 'design', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (20, 9, 'Commercial Mowing', 'Commercial property mowing', 120, 195.00, true, 'maintenance', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');
INSERT INTO public.services (id, company_id, name, description, duration_minutes, base_price, is_active, category, created_at, updated_at) VALUES (21, 9, 'Irrigation Maintenance', 'Sprinkler system check', 60, 175.00, true, 'treatment', '2026-03-22 17:09:45.373961', '2026-03-22 17:09:45.373961');


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (1, 1, 'Alex', 'Green', 'alex@greenscapes.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, '2026-03-22 15:25:27.722', '2026-03-22 07:20:23.959009', '2026-03-22 07:20:23.959009');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (3, 3, 'Sarah', 'Nguyen', 'sarah@greenthumb.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (4, 4, 'Carlos', 'Rivera', 'carlos@cutright.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (5, 5, 'Jessica', 'Moore', 'jessica@precision.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (6, 6, 'Ryan', 'Patel', 'ryan@evergreen.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (7, 7, 'Amanda', 'Torres', 'amanda@elitelawn.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (8, 8, 'Derek', 'Kim', 'derek@turfmaster.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (9, 9, 'Lisa', 'Johnson', 'lisa@greenwave.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, NULL, '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');
INSERT INTO public.users (id, company_id, first_name, last_name, email, password_hash, role, phone, is_active, last_login_at, created_at, updated_at) VALUES (2, 2, 'Mike', 'Porter', 'mike@lawnpro.com', '$2b$12$rFdNkicGRyHCr/N7hwPAROphLRj/L0Z9/.WYELqbF4hnRFQp.cYn2', 'owner', NULL, true, '2026-03-22 20:06:00.816', '2026-03-22 17:09:26.11386', '2026-03-22 17:09:26.11386');


--
-- Name: activity_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_logs_id_seq', 35, true);


--
-- Name: appointments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.appointments_id_seq', 34, true);


--
-- Name: automation_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.automation_rules_id_seq', 3, true);


--
-- Name: companies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.companies_id_seq', 9, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customers_id_seq', 30, true);


--
-- Name: estimates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.estimates_id_seq', 3, true);


--
-- Name: invoices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.invoices_id_seq', 6, true);


--
-- Name: platform_admins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platform_admins_id_seq', 1, true);


--
-- Name: properties_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.properties_id_seq', 6, true);


--
-- Name: recurring_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recurring_plans_id_seq', 3, true);


--
-- Name: review_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.review_requests_id_seq', 3, true);


--
-- Name: route_stops_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.route_stops_id_seq', 1, false);


--
-- Name: routes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.routes_id_seq', 1, true);


--
-- Name: services_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.services_id_seq', 21, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 9, true);


--
-- PostgreSQL database dump complete
--

\unrestrict CW0nV4SWKZ3X3rrfkd6ratt0HZQzlgilRxERPHyUYa78bCKVMejDr06Y7G1JKEu

