# Cataseek AI Search - PrestaShop Module

AI-powered search engine that understands your customers' intent and provides intelligent product recommendations.

## Features

- 🤖 **AI-Powered Search**: Intelligent search that understands natural language queries
- 🎨 **Modern Glassmorphic UI**: Beautiful, premium search interface
- ⚡ **Real-time Sync**: Automatic product synchronization with Cataseek API
- 🎯 **Smart Results**: Shows relevant products with images, prices, and stock status
- 📱 **Fully Responsive**: Works perfectly on desktop, tablet, and mobile
- 🎨 **Customizable**: Choose colors, modal size, and icon position
- 🔄 **Bulk Sync**: Easy batch synchronization of all products

## Requirements

- PrestaShop 1.7.0.0 - 9.0.0+
- PHP 7.1 or higher
- cURL extension enabled
- Cataseek API credentials

## Installation

1. Download the module ZIP file
2. Go to your PrestaShop back office
3. Navigate to **Modules > Module Manager**
4. Click **Upload a module**
5. Select the ZIP file and upload
6. Click **Configure** on the Cataseek module
7. Enter your API credentials
8. Customize the design settings
9. Enable "Live Mode"
10. Click "Start Bulk Sync" to sync existing products

## Configuration

### API Settings

- **Live Mode**: Enable/disable product synchronization
- **API URL**: Your Cataseek API endpoint
- **API Key**: Your API authentication key
- **API Password**: Your API authentication password

### Design Settings

- **Widget Accent Color**: Choose the primary color for the search widget
- **Modal Size**: Select from Small, Medium, or Large
- **Icon Position**: Position the search icon (Left, Center, or Right)

### Bulk Sync

Use the "Start Bulk Sync" button to synchronize all products from your catalog to Cataseek. The process runs in batches to avoid timeouts.

## File Structure

```
cataseek/
├── cataseek.php                                    # Main module file
├── config.xml                                    # Module configuration
├── index.php                                     # Security file
├── controllers/
│   └── admin/
│       ├── AdminCataseekSyncController.php        # AJAX handler
│       └── index.php                            # Security file
├── views/
│   ├── css/
│   │   ├── cataseek-front.css                    # Frontend styles
│   │   └── index.php                           # Security file
│   ├── js/
│   │   ├── cataseek-front.js                     # Frontend JavaScript
│   │   └── index.php                           # Security file
│   └── templates/
│       ├── admin/
│       │   ├── configure.tpl                   # Admin configuration
│       │   └── index.php                       # Security file
│       └── hook/
│           ├── cataseek-widget.tpl               # Search widget template
│           └── index.php                       # Security file
└── README.md                                    # This file
```

## Usage

### For Customers

1. Click the "AI Search" button in the header
2. Type your search query in the modal
3. View intelligent search results in real-time
4. Click on any product to view details

### For Store Owners

The module automatically syncs products when you:
- Add a new product
- Update an existing product
- Delete a product

You can also manually trigger a bulk sync from the module configuration page.

## API Endpoints Used

- `POST /products/sync` - Sync products to Cataseek
- `POST /products/delete` - Delete products from Cataseek
- `POST /products/search` - Search products
- `GET /status` - Test API connection

## Hooks Used

- `displayHeader` - Load CSS and JavaScript files
- `displayTop` - Display search icon in header
- `actionObjectProductUpdateAfter` - Sync product on update
- `actionObjectProductAddAfter` - Sync product on add
- `actionObjectProductDeleteAfter` - Delete product from Cataseek

## Troubleshooting

### Search not working

1. Check if "Live Mode" is enabled
2. Verify API credentials are correct
3. Use "Test API Connection" button
4. Check browser console for errors

### Products not syncing

1. Ensure "Live Mode" is enabled
2. Check API credentials
3. Verify cURL is enabled on your server
4. Check PrestaShop error logs

### Styling issues

1. Clear PrestaShop cache
2. Clear browser cache
3. Check for CSS conflicts with theme

## Support

For support, please contact: support@gofenice.com

## License

Commercial License - © 2026 gofenice

## Changelog

### Version 1.0.0 (2026-01-07)
- Initial release
- AI-powered search functionality
- Real-time product synchronization
- Modern glassmorphic UI
- Bulk sync feature
- Customizable design options