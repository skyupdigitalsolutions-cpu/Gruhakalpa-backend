# Navanagara Backend - MVC Structure

This is the refactored backend for the Navanagara membership and site booking management system, now organized with proper MVC architecture.

## 📁 Project Structure

```
navanagara-backend/
│
├── config/
│   └── database.js          # Database connection configuration
│
├── models/
│   ├── Admin.js             # Admin schema
│   ├── Member.js            # Member schema
│   ├── Payment.js           # Payment schema
│   ├── Receipt.js           # Receipt schema
│   └── SiteBooking.js       # Site booking schema
│
├── controllers/
│   ├── adminController.js   # Admin business logic
│   ├── memberController.js  # Member business logic
│   ├── paymentController.js # Payment business logic
│   ├── receiptController.js # Receipt business logic
│   └── siteBookingController.js # Site booking business logic
│
├── routes/
│   ├── adminRoutes.js       # Admin API endpoints
│   ├── memberRoutes.js      # Member API endpoints
│   ├── paymentRoutes.js     # Payment API endpoints
│   ├── receiptRoutes.js     # Receipt API endpoints
│   └── siteBookingRoutes.js # Site booking API endpoints
│
├── .env                     # Environment variables
├── server.js                # Main application entry point
└── package.json             # Project dependencies
```

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (running on localhost:27017)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```env
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/navanagara
```

3. Start the server:
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## 📡 API Endpoints

All endpoints are prefixed with `/api`

### Admin Routes
- `POST /api/add-admin` - Add new admin
- `GET /api/admins` - Get all admins
- `PUT /api/edit-admin/:id` - Update admin by ID

### Member Routes
- `POST /api/add-members` - Add new member
- `GET /api/members` - Get all members
- `PUT /api/update-member/:id` - Update member by ID

### Payment Routes
- `POST /api/add-payment` - Add new payment
- `GET /api/payments` - Get all payments

### Site Booking Routes
- `POST /api/site-booking` - Create site booking
- `GET /api/sitebookings` - Get all site bookings
- `PUT /api/update-sitebooking/:id` - Update site booking by ID

### Receipt Routes
- `POST /api/receipt` - Generate receipt
- `GET /api/receipts` - Get all receipts
- `PUT /api/backfill-receipts` - Backfill receipt data

## 🔧 Key Changes from Original Code

1. **Mongoose Models**: Replaced raw MongoDB operations with Mongoose schemas for better data validation and structure
2. **Async/Await**: All database operations now use async/await for better error handling
3. **Separation of Concerns**: Business logic (controllers) is separate from routing and data models
4. **Database Connection**: Centralized database configuration
5. **API Prefix**: All routes now use `/api` prefix for better organization

## 📝 Notes

- Make sure MongoDB is running before starting the server
- The database name is `navanagara`
- All routes that were previously at root level are now under `/api` prefix
- Example: `/add-admin` is now `/api/add-admin`

## 🛠️ Future Improvements

Consider adding:
- Input validation middleware
- Authentication & authorization
- Error handling middleware
- Request logging
- API documentation (Swagger/OpenAPI)
- Environment-based configuration
- Database migration scripts
