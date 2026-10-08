# Customize your profile icon

Open Community → Your community profile. Upload a JPG, PNG, or WebP picture (up to 10 MB), or choose an icon and background color, check the preview, then select Save profile. Choose Initials to return to a name-based icon.

Icons appear in the account header, comments, chat, mentions, and member leaderboards. Participation badges remain automatic and separate from the customizable icon. Your choice is saved to your account and works across devices.

Deployment applies migration `0030_profile_icons_20261008.sql` before publishing the Worker. Existing members default to initials with a teal background. Only the authenticated member can change their own icon through the profile form.

Pictures are cropped to a centered square and resized to 256 × 256 pixels in the browser. The server validates JPEG data and stores at most 32 KB per member in a separate table. Pictures are publicly visible through an opaque URL; replacement or removal invalidates the previous URL. Remove picture / use icon returns to the selected icon after Save profile. Migration `0031_profile_pictures_20261008.sql` requires no new storage binding.
